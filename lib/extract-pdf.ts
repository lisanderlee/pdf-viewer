import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const standardFontDataUrl = `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")}${path.sep}`;

export type DeckPage = {
  pageNumber: number;
  text: string;
};

export type DeckKnowledge = {
  sourceEtag: string;
  pages: DeckPage[];
};

const TEXT_BUDGET = 80_000;

export async function extractDeckPages(bytes: Uint8Array): Promise<DeckPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl,
    useSystemFonts: false,
  });

  try {
    const document = await task.promise;
    const pages: DeckPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ pageNumber, text: pageText(content.items as Array<{ str?: unknown; hasEOL?: boolean }>) });
    }
    return fitPages(pages);
  } finally {
    await task.destroy();
  }
}

export function formatDeck(pages: DeckPage[]): string {
  return pages
    .map((page) => `Page ${page.pageNumber}\n${page.text || "(no text)"}`)
    .join("\n\n");
}

function pageText(items: Array<{ str?: unknown; hasEOL?: boolean }>): string {
  let text = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function fitPages(pages: DeckPage[]): DeckPage[] {
  const total = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (total <= TEXT_BUDGET) return pages;

  const allowance = Math.max(1, Math.floor(TEXT_BUDGET / pages.length));
  return pages.map((page) =>
    page.text.length <= allowance
      ? page
      : { ...page, text: `${page.text.slice(0, allowance).trimEnd()}…` },
  );
}
