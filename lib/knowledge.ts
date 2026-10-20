import "server-only";

import { BlobNotFoundError, get, head, put } from "@vercel/blob";
import { extractDeckPages, formatDeck, type DeckKnowledge } from "@/lib/extract-pdf";
import { KNOWLEDGE_PATHNAME, PDF_PATHNAME } from "@/lib/pdf";

export type KnowledgeLookup =
  | { status: "ready"; text: string }
  | { status: "unread" }
  | { status: "absent" };

export async function indexCurrentPdf(): Promise<void> {
  const blob = await head(PDF_PATHNAME);
  const stored = await readStoredKnowledge();
  if (stored?.sourceEtag === blob.etag) return;

  const response = await fetch(blob.url);
  if (!response.ok) {
    throw new Error("The PDF could not be read.");
  }

  const pages = await extractDeckPages(new Uint8Array(await response.arrayBuffer()));
  const knowledge: DeckKnowledge = { sourceEtag: blob.etag, pages };
  await put(KNOWLEDGE_PATHNAME, JSON.stringify(knowledge), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function loadKnowledgeForChat(): Promise<KnowledgeLookup> {
  let sourceEtag: string;
  try {
    sourceEtag = (await head(PDF_PATHNAME)).etag;
  } catch (error) {
    if (isAbsentPdf(error)) return { status: "absent" };
    throw error;
  }

  const stored = await readStoredKnowledge();
  if (!stored || stored.sourceEtag !== sourceEtag) return { status: "unread" };
  return { status: "ready", text: formatDeck(stored.pages) };
}

async function readStoredKnowledge(): Promise<DeckKnowledge | null> {
  try {
    const result = await get(KNOWLEDGE_PATHNAME, { access: "public" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return parseKnowledge(await new Response(result.stream).text());
  } catch (error) {
    if (isMissingKnowledge(error)) return null;
    throw error;
  }
}

function isMissingKnowledge(error: unknown): boolean {
  if (error instanceof BlobNotFoundError) return true;
  if (!(error instanceof Error)) return false;
  return error.message.includes("Failed to fetch blob: 400") || error.message.includes("404");
}

function parseKnowledge(raw: string): DeckKnowledge | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const sourceEtag = (parsed as { sourceEtag?: unknown }).sourceEtag;
  const pages = (parsed as { pages?: unknown }).pages;
  if (typeof sourceEtag !== "string" || !Array.isArray(pages)) return null;

  const deckPages = pages.flatMap((page) => {
    if (!page || typeof page !== "object") return [];
    const pageNumber = (page as { pageNumber?: unknown }).pageNumber;
    const text = (page as { text?: unknown }).text;
    if (typeof pageNumber !== "number" || typeof text !== "string") return [];
    return [{ pageNumber, text }];
  });

  return { sourceEtag, pages: deckPages };
}

function isAbsentPdf(error: unknown): boolean {
  if (error instanceof BlobNotFoundError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("No blob credentials") ||
    error.message.includes("No read-write token")
  );
}
