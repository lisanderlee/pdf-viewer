import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isUploadAuthorized } from "@/lib/password";
import { MAX_PDF_BYTES, PDF_PATHNAME } from "@/lib/pdf";

type AuthorizeBody = {
  type: "authorize";
  password?: string;
};

export async function POST(request: Request) {
  let body: HandleUploadBody | AuthorizeBody;
  try {
    body = (await request.json()) as HandleUploadBody | AuthorizeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (isAuthorizeBody(body)) {
    if (!isUploadAuthorized(body.password)) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.type === "blob.generate-client-token") {
    if (!isUploadAuthorized(body.payload.clientPayload)) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    if (body.payload.pathname !== PDF_PATHNAME) {
      return NextResponse.json({ error: "Unexpected file path." }, { status: 400 });
    }
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isUploadAuthorized(clientPayload)) {
          throw new Error("Wrong password.");
        }
        if (pathname !== PDF_PATHNAME) {
          throw new Error("Unexpected file path.");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    const safe =
      message === "Wrong password." || message === "Unexpected file path."
        ? message
        : "Upload failed.";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

function isAuthorizeBody(
  body: HandleUploadBody | AuthorizeBody,
): body is AuthorizeBody {
  return body.type === "authorize";
}
