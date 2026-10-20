"use client";

import { uploadPresigned } from "@vercel/blob/client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MAX_PDF_BYTES, PDF_PATHNAME } from "@/lib/pdf";

export function UploadForm() {
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setReadError(null);
    setDone(false);

    if (!file) {
      setError("Choose a PDF.");
      return;
    }
    if (!isPdf(file)) {
      setError("Choose a PDF file.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError("PDF must be 100 MB or smaller.");
      return;
    }

    setPending(true);
    setProgress(0);

    try {
      const authorized = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "authorize", password }),
      });
      if (!authorized.ok) {
        setError("Wrong password.");
        return;
      }

      await uploadPresigned(PDF_PATHNAME, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: password,
        contentType: "application/pdf",
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => {
          setProgress(Math.round(percentage));
        },
      });
      setProgress(100);
      setDone(true);
      setReading(true);
      try {
        const indexed = await fetch("/api/index", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!indexed.ok) {
          setReadError("The file is updated, but the chat could not read it yet.");
        }
      } catch {
        setReadError("The file is updated, but the chat could not read it yet.");
      } finally {
        setReading(false);
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Upload failed.";
      setError(
        message.includes("presigned URL") || message.includes("client token")
          ? "Upload failed. Check that blob storage is configured."
          : message,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="upload-card" onSubmit={onSubmit}>
      <div className="upload-intro">
        <h1>Update PDF</h1>
        <p>Replace the file at the shared link. The page address stays the same.</p>
      </div>

      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          required
          disabled={pending || reading}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      <label>
        PDF file
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          disabled={pending || reading}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <button type="submit" disabled={pending || reading}>
        {pending ? "Uploading…" : "Upload"}
      </button>

      {progress !== null && pending ? (
        <div className="progress">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>{progress}%</p>
        </div>
      ) : null}

      {error ? (
        <p className="upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {reading ? (
        <p className="upload-success" role="status">
          Reading the new deck…
        </p>
      ) : null}

      {readError ? (
        <p className="upload-error" role="alert">
          {readError}
        </p>
      ) : null}

      {done && !reading && !readError ? (
        <p className="upload-success" role="status">
          PDF updated. It can take up to a minute to replace the previous file.{" "}
          <Link href="/">Open the document</Link>
        </p>
      ) : null}
    </form>
  );
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}
