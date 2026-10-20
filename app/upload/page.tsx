import type { Metadata } from "next";
import { UploadForm } from "@/components/upload-form";

export const metadata: Metadata = {
  title: "Update PDF",
};

export default function UploadPage() {
  return (
    <main className="upload-page">
      <UploadForm />
    </main>
  );
}
