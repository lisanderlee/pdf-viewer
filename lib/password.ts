import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export function isUploadAuthorized(password: string | null | undefined): boolean {
  const expected = process.env.UPLOAD_PASSWORD;
  if (!expected || !password) return false;

  const actualHash = createHash("sha256").update(password).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
