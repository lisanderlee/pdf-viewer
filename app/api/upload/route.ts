import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { indexCurrentPdf } from "@/lib/knowledge";
import { isUploadAuthorized } from "@/lib/password";
import { MAX_PDF_BYTES, PDF_PATHNAME } from "@/lib/pdf";

type AuthorizeBody = {
  type: "authorize";
  password?: string;
};

const uploadConstraints = {
  allowedContentTypes: ["application/pdf"],
  maximumSizeInBytes: MAX_PDF_BYTES,
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
};

export async function POST(request: Request) {
  let body: HandleUploadPresignedBody | AuthorizeBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody | AuthorizeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (isAuthorizeBody(body)) {
    if (!isUploadAuthorized(body.password)) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.type === "blob.generate-presigned-url") {
    const rejected = rejectUpload(body.payload.pathname, body.payload.clientPayload);
    if (rejected) return rejected;
  }

  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
        const rejected = rejectUpload(pathname, clientPayload);
        if (rejected) {
          throw new Error(
            pathname === PDF_PATHNAME ? "Wrong password." : "Unexpected file path.",
          );
        }

        const token = await issueSignedToken({
          pathname: PDF_PATHNAME,
          operations: ["put"],
          allowedContentTypes: uploadConstraints.allowedContentTypes,
          maximumSizeInBytes: uploadConstraints.maximumSizeInBytes,
        });

        return {
          token,
          urlOptions: { ...uploadConstraints },
        };
      },
      onUploadCompleted: async ({ blob }) => {
        if (blob.pathname !== PDF_PATHNAME) return;
        await indexCurrentPdf();
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}

function rejectUpload(pathname: string, password: string | null) {
  if (!isUploadAuthorized(password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  if (pathname !== PDF_PATHNAME) {
    return NextResponse.json({ error: "Unexpected file path." }, { status: 400 });
  }
  return null;
}

function isAuthorizeBody(
  body: HandleUploadPresignedBody | AuthorizeBody,
): body is AuthorizeBody {
  return body.type === "authorize";
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Upload failed.";
  const stripped = message.replace(/^Vercel Blob:\s*/, "");
  if (stripped === "Wrong password." || stripped === "Unexpected file path.") {
    return stripped;
  }
  if (
    stripped.includes("webhook public key") ||
    stripped.includes("No blob credentials") ||
    stripped.includes("BLOB_STORE_ID")
  ) {
    return "Upload failed. Check that blob storage is configured.";
  }
  return "Upload failed.";
}
