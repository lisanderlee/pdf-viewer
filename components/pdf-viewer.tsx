"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { PdfNav, type NavItem } from "@/components/pdf-nav";

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
  const [outline, setOutline] = useState<NavItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
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

      const sections = await readOutline(document);
      if (cancelled) return;

      setDoc(document);
      setPages(sizes);
      setOutline(sections);
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
  const activeIds = activeSectionIds(outline, currentPage);

  useEffect(() => {
    if (!outline.length) return;

    const update = () => {
      const page = currentPageNumber(NAV_HEIGHT);
      if (page !== null) setCurrentPage(page);
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, [outline]);

  useEffect(() => {
    if (!outline.length) return;

    const openHashedSection = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const match = findSection(outline, id);
      if (!match) return;
      scrollToPage(match.pageNumber, "auto");
      requestAnimationFrame(() => setCurrentPage(match.pageNumber));
    };

    openHashedSection();
    window.addEventListener("hashchange", openHashedSection);
    return () => window.removeEventListener("hashchange", openHashedSection);
  }, [outline]);

  function selectSection(item: NavItem) {
    scrollToPage(item.pageNumber);
    setCurrentPage(item.pageNumber);
    const url = new URL(window.location.href);
    url.hash = item.id;
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      {outline.length > 0 ? (
        <PdfNav items={outline} activeIds={activeIds} onSelect={selectSection} />
      ) : null}
      <main
        className={
          ready
            ? outline.length > 0
              ? "pdf-stage has-nav"
              : "pdf-stage"
            : "pdf-stage pdf-stage-pending"
        }
        ref={stageRef}
      >
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
    </>
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
      const current = currentPageNumber() ?? 1;
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

const NAV_HEIGHT = 48;

function currentPageNumber(offset = 0) {
  const pages = document.querySelectorAll<HTMLElement>("[data-page-number]");
  const first = pages[0];
  if (!first || first.offsetHeight === 0) return null;

  const line = window.scrollY + offset + 8;
  let current = 1;
  pages.forEach((element) => {
    if (element.offsetHeight > 0 && element.offsetTop <= line) {
      current = Number(element.dataset.pageNumber) || current;
    }
  });
  return current;
}

function scrollToPage(pageNumber: number, behavior: ScrollBehavior = "smooth") {
  const element = document.querySelector<HTMLElement>(
    `[data-page-number="${pageNumber}"]`,
  );
  if (!element) return;
  const navOffset = document.querySelector(".pdf-nav") ? NAV_HEIGHT : 0;
  const top = element.getBoundingClientRect().top + window.scrollY - navOffset;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

type OutlineNode = {
  title: string;
  dest: string | Array<unknown> | null;
  items?: OutlineNode[];
};

async function readOutline(doc: PDFDocumentProxy): Promise<NavItem[]> {
  const outline = (await doc.getOutline()) as OutlineNode[] | null;
  if (!outline?.length) return [];

  const maxDepth = outlineDepth(outline) > 2 ? 1 : 2;
  const used = new Set<string>();
  const items = await Promise.all(
    outline.map((node) => toNavItem(doc, node, maxDepth, used)),
  );
  return items.filter((item): item is NavItem => item !== null);
}

function outlineDepth(nodes: OutlineNode[], depth = 1): number {
  return nodes.reduce((max, node) => {
    const childDepth = node.items?.length ? outlineDepth(node.items, depth + 1) : depth;
    return Math.max(max, childDepth);
  }, depth);
}

async function toNavItem(
  doc: PDFDocumentProxy,
  node: OutlineNode,
  maxDepth: number,
  used: Set<string>,
): Promise<NavItem | null> {
  const pageNumber = await destinationPage(doc, node.dest);
  if (!pageNumber) return null;

  const children =
    maxDepth > 1 && node.items?.length
      ? (
          await Promise.all(node.items.map((item) => toNavItem(doc, item, maxDepth - 1, used)))
        ).filter((item): item is NavItem => item !== null)
      : [];

  return {
    id: uniqueSlug(node.title, used),
    title: node.title,
    pageNumber,
    items: children,
  };
}

async function destinationPage(doc: PDFDocumentProxy, dest: OutlineNode["dest"]) {
  let explicit: unknown = dest;
  if (typeof dest === "string") {
    explicit = await doc.getDestination(dest);
  }
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  return resolvePageNumber(doc, explicit[0]);
}

function uniqueSlug(title: string, used: Set<string>) {
  const base =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  let slug = base;
  let count = 2;
  while (used.has(slug)) {
    slug = `${base}-${count}`;
    count += 1;
  }
  used.add(slug);
  return slug;
}

function findSection(items: NavItem[], id: string): NavItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const child = findSection(item.items, id);
    if (child) return child;
  }
  return null;
}

function activeSectionIds(items: NavItem[], page: number) {
  let active: string | null = null;
  const parents = new Map<string, string | null>();

  function walk(list: NavItem[], parentId: string | null) {
    for (const item of list) {
      parents.set(item.id, parentId);
      if (item.pageNumber <= page) active = item.id;
      walk(item.items, item.id);
    }
  }

  walk(items, null);
  const ids: string[] = [];
  while (active) {
    ids.push(active);
    active = parents.get(active) ?? null;
  }
  return ids;
}
