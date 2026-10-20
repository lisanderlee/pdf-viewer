import { Suspense } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { PdfViewer } from "@/components/pdf-viewer";
import { StatusMessage } from "@/components/status-message";
import { getCurrentPdf } from "@/lib/current-pdf";

export default function HomePage() {
  return (
    <Suspense fallback={<StatusMessage message="Loading document…" />}>
      <CurrentDocument />
    </Suspense>
  );
}

async function CurrentDocument() {
  const pdf = await getCurrentPdf();
  if (!pdf) {
    return <StatusMessage message="No PDF has been uploaded yet." />;
  }

  return (
    <>
      <PdfViewer key={pdf.src} src={pdf.src} />
      <ChatPanel />
    </>
  );
}
