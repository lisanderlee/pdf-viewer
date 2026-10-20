import { NextResponse } from "next/server";
import { indexCurrentPdf } from "@/lib/knowledge";
import { isUploadAuthorized } from "@/lib/password";

export const maxDuration = 60;

type IndexBody = {
  password?: string;
};

export async function POST(request: Request) {
  let body: IndexBody;
  try {
    body = (await request.json()) as IndexBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!isUploadAuthorized(body.password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  try {
    await indexCurrentPdf();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "The deck could not be read." },
      { status: 500 },
    );
  }
}
