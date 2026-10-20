"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

type PageSize = {
  pageNumber: number;
  width: number;
  height: number;
};

type LinkService = {
  addLinkAttributes: (
    link: HTMLAnchorElement,
    url: string,
    newWindow?: boolean,
  ) => void;
  getDestinationHash: (dest: unknown) => string;
  goToDestination: (dest: unknown) => Promise<void> | void;
  getAnchorUrl: (hash?: string) => string;
  executeNamedAction: (action: string) => void;
  executeSetOCGState: (action: unknown) => void;
  getAttachmentContent: (id: string) => Promise<Uint8Array | null>;
};

export function PdfViewer({ src }: { src: string }) {
  const stageRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const linkService = useMemo(() => (doc ? createLinkService(doc) : null), [doc]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => setWidth(stage.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function load() {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ url: src });
      loadingTask = task;
      const document = await task.promise;
      if (cancelled) return;

      const sizes = await Promise.all(
        Array.from({ length: document.numPages }, async (_, index) => {
          const page = await document.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1 });
          return {
            pageNumber: index + 1,
            width: viewport.width,
            height: viewport.height,
          };
        }),
      );
      if (cancelled) return;

      setDoc(document);
      setPages(sizes);
    }

    load().catch((loadError: unknown) => {
      if (cancelled) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The document could not be opened.",
      );
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [src]);

  const ready = doc && linkService && width > 0;

  return (
    <main className={ready ? "pdf-stage" : "pdf-stage pdf-stage-pending"} ref={stageRef}>
      {error ? (
        <p className="status-copy">{error}</p>
      ) : !ready ? (
        <p className="status-copy">Loading document…</p>
      ) : (
        pages.map((page) => (
          <PdfPage
            key={page.pageNumber}
            doc={doc}
            linkService={linkService}
            pageNumber={page.pageNumber}
            pageWidth={page.width}
            pageHeight={page.height}
            displayWidth={width}
          />
        ))
      )}
    </main>
  );
}

function PdfPage({
  doc,
  linkService,
  pageNumber,
  pageWidth,
  pageHeight,
  displayWidth,
}: {
  doc: PDFDocumentProxy;
  linkService: LinkService;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  displayWidth: number;
}) {
  const pageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "150% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    const canvas = canvasRef.current;
    const annotationLayer = annotationRef.current;
    if (!canvas || !annotationLayer) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let layer: { destroy: () => void } | null = null;

    async function paint() {
      const pdfjs = await import("pdfjs-dist");
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const scale = displayWidth / pageWidth;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas!.height = Math.max(1, Math.floor(viewport.height * ratio));

      const task = page.render({
        canvas: canvas!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        annotationMode: pdfjs.AnnotationMode.ENABLE,
      });
      renderTask = task;
      if (cancelled) {
        task.cancel();
        return;
      }

      await task.promise;
      if (cancelled) return;

      annotationLayer!.style.setProperty("--scale-factor", String(scale));
      annotationLayer!.style.setProperty("--user-unit", String(viewport.userUnit || 1));
      annotationLayer!.replaceChildren();

      const annotations = await page.getAnnotations({ intent: "display" });
      if (cancelled) return;

      const nextLayer = new pdfjs.AnnotationLayer({
        div: annotationLayer,
        page,
        viewport,
        linkService,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null,
        annotationStorage: null,
      });
      await nextLayer.render({
        viewport,
        div: annotationLayer!,
        annotations,
        page,
        linkService: linkService as never,
        renderForms: false,
      });
      if (cancelled) {
        nextLayer.destroy();
        return;
      }

      annotationLayer!.style.width = "100%";
      annotationLayer!.style.height = "100%";
      layer = nextLayer;
    }

    paint().catch((paintError: unknown) => {
      if (cancelled) return;
      if (
        paintError instanceof Error &&
        paintError.name === "RenderingCancelledException"
      ) {
        return;
      }
      console.error(paintError);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      layer?.destroy();
      canvas.width = 0;
      canvas.height = 0;
      annotationLayer.replaceChildren();
    };
  }, [displayWidth, doc, linkService, near, pageNumber, pageWidth]);

  return (
    <section
      ref={pageRef}
      className="pdf-page"
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{ height: displayWidth * (pageHeight / pageWidth) }}
    >
      {near ? (
        <>
          <canvas ref={canvasRef} />
          <div ref={annotationRef} className="annotationLayer" />
        </>
      ) : null}
    </section>
  );
}

function createLinkService(doc: PDFDocumentProxy): LinkService {
  return {
    addLinkAttributes(link, url, newWindow = false) {
      link.href = url;
      link.rel = "noopener noreferrer";
      if (newWindow) link.target = "_blank";
    },
    getDestinationHash(dest) {
      return typeof dest === "string" ? `#${encodeURIComponent(dest)}` : "#";
    },
    getAnchorUrl() {
      return "#";
    },
    async goToDestination(dest) {
      let explicit: unknown = dest;
      if (typeof dest === "string") {
        explicit = await doc.getDestination(dest);
      }
      if (!Array.isArray(explicit) || explicit.length === 0) return;
      const pageNumber = await resolvePageNumber(doc, explicit[0]);
      if (pageNumber) scrollToPage(pageNumber);
    },
    executeNamedAction(action) {
      const nodes = [
        ...document.querySelectorAll<HTMLElement>("[data-page-number]"),
      ];
      const last = Number(nodes.at(-1)?.dataset.pageNumber) || 1;
      const current = currentPageNumber();
      if (action === "NextPage") scrollToPage(Math.min(last, current + 1));
      else if (action === "PrevPage") scrollToPage(Math.max(1, current - 1));
      else if (action === "FirstPage") scrollToPage(1);
      else if (action === "LastPage") scrollToPage(last);
    },
    executeSetOCGState() {},
    async getAttachmentContent() {
      return null;
    },
  };
}

async function resolvePageNumber(doc: PDFDocumentProxy, destRef: unknown) {
  if (typeof destRef === "number" && Number.isFinite(destRef)) {
    return destRef + 1;
  }
  if (isPageRef(destRef)) {
    return (await doc.getPageIndex(destRef)) + 1;
  }
  return null;
}

function isPageRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "num" in value &&
    "gen" in value &&
    typeof value.num === "number" &&
    typeof value.gen === "number"
  );
}

function currentPageNumber() {
  const line = window.scrollY + 8;
  let current = 1;
  document.querySelectorAll<HTMLElement>("[data-page-number]").forEach((element) => {
    if (element.offsetTop <= line) {
      current = Number(element.dataset.pageNumber) || current;
    }
  });
  return current;
}

function scrollToPage(pageNumber: number) {
  document
    .querySelector(`[data-page-number="${pageNumber}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}
