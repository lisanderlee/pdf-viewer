import "server-only";

import { BlobNotFoundError, head } from "@vercel/blob";
import { connection } from "next/server";
import { PDF_PATHNAME } from "@/lib/pdf";

export async function getCurrentPdf(): Promise<{ src: string } | null> {
  await connection();

  try {
    const blob = await head(PDF_PATHNAME);
    const fileUrl = new URL(blob.url);
    fileUrl.searchParams.set("v", blob.etag);
    return { src: fileUrl.toString() };
  } catch (error) {
    if (isAbsentPdf(error)) return null;
    throw error;
  }
}

function isAbsentPdf(error: unknown): boolean {
  if (error instanceof BlobNotFoundError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("No blob credentials") ||
    error.message.includes("No read-write token")
  );
}
