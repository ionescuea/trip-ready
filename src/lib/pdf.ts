"use client";

import { normalizeExtractedText } from "./pdfText";

type TextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
};

/** Rebuild PDF text using positions so dates/labels stay readable. */
function pageItemsToText(items: TextItem[]): string {
  const rows: { y: number; parts: { x: number; text: string }[] }[] = [];

  for (const item of items) {
    const str = item.str ?? "";
    if (!str) continue;
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const x = transform[4] ?? 0;
    const y = Math.round((transform[5] ?? 0) * 10) / 10;

    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, text: str });
    if (item.hasEOL) {
      row.parts.push({ x: x + (item.width ?? 0) + 1, text: "\n" });
    }
  }

  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let lastEnd = -Infinity;
      for (const part of row.parts) {
        if (part.text === "\n") {
          line += "\n";
          lastEnd = -Infinity;
          continue;
        }
        if (line && part.x - lastEnd > 1.5) line += " ";
        line += part.text;
        lastEnd = part.x + part.text.length * 4;
      }
      return line.replace(/[ \t]+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

async function configurePdfWorker() {
  const pdfjs = await import("pdfjs-dist");
  // Same-origin file in /public — import.meta worker URLs often fail on iOS/Samsung.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

/** Cap canvas size so iOS / Android don’t blank out on large boarding-pass pages. */
function safeRenderScale(
  pageWidthPt: number,
  pageHeightPt: number,
  desired: number,
): number {
  const MAX_EDGE = 2048;
  const MAX_PIXELS = 3_500_000;
  let scale = desired;
  if (pageWidthPt * scale > MAX_EDGE || pageHeightPt * scale > MAX_EDGE) {
    scale = Math.min(scale, MAX_EDGE / pageWidthPt, MAX_EDGE / pageHeightPt);
  }
  if (pageWidthPt * scale * pageHeightPt * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (pageWidthPt * pageHeightPt));
  }
  return Math.max(0.75, scale);
}

export function preferredPdfScale(): number {
  if (typeof window === "undefined") return 2;
  const narrow = window.innerWidth < 700;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return narrow || coarse ? 1.55 : 2.25;
}

/** Extract plain text from a PDF File in the browser (PDF.js). */
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await configurePdfWorker();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = pageItemsToText(content.items as TextItem[]);
    if (pageText.trim()) pages.push(pageText.trim());
  }

  const text = normalizeExtractedText(pages.join("\n\n"));
  if (!text) {
    throw new Error(
      "No readable text in this PDF (it may be a scanned image). Paste the text or use a text-based confirmation.",
    );
  }
  return text;
}

/**
 * Rasterise a PDF (signed URL or data URL) for in-app viewing.
 * Phones often show a blank page for PDF iframes.
 */
export async function renderPdfUrlToImages(
  url: string,
  opts?: { maxPages?: number; scale?: number },
): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Could not download the boarding pass PDF.");
  }
  const data = new Uint8Array(await res.arrayBuffer());
  return renderPdfBytesToImages(data, opts);
}

export async function renderPdfBytesToImages(
  data: Uint8Array,
  opts?: { maxPages?: number; scale?: number },
): Promise<string[]> {
  const pdfjs = await configurePdfWorker();
  const maxPages = opts?.maxPages ?? 12;
  const desired = opts?.scale ?? preferredPdfScale();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const images: string[] = [];
  const limit = Math.min(pdf.numPages, maxPages);

  for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = safeRenderScale(base.width, base.height, desired);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const canvasContext = canvas.getContext("2d", { alpha: false });
    if (!canvasContext) {
      throw new Error("Could not draw the boarding pass.");
    }
    await page.render({ canvasContext, canvas, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.88));
    canvas.width = 0;
    canvas.height = 0;
  }

  if (images.length === 0) {
    throw new Error("This PDF has no pages to show.");
  }
  return images;
}

export type SplitPdfPage = {
  page: number;
  /** JPEG of this page */
  file: File;
  dataUrl: string;
  /** Text extracted from the page (for matching traveller names) */
  text: string;
};

/** Split a boarding-pass PDF into one JPEG file per page. */
export async function splitPdfFileToPages(
  file: File,
  opts?: { maxPages?: number; scale?: number },
): Promise<SplitPdfPage[]> {
  const pdfjs = await configurePdfWorker();
  const maxPages = opts?.maxPages ?? 12;
  const desired = opts?.scale ?? preferredPdfScale();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const limit = Math.min(pdf.numPages, maxPages);
  const pages: SplitPdfPage[] = [];
  const baseName = file.name.replace(/\.pdf$/i, "") || "boarding-pass";

  for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = safeRenderScale(base.width, base.height, desired);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const canvasContext = canvas.getContext("2d", { alpha: false });
    if (!canvasContext) {
      throw new Error("Could not draw the boarding pass.");
    }
    await page.render({ canvasContext, canvas, viewport }).promise;

    let text = "";
    try {
      const content = await page.getTextContent();
      text = pageItemsToText(content.items as TextItem[]);
    } catch {
      text = "";
    }

    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    canvas.width = 0;
    canvas.height = 0;

    const blob = await (await fetch(dataUrl)).blob();
    const pageFile = new File([blob], `${baseName}-p${pageNum}.jpg`, {
      type: "image/jpeg",
    });
    pages.push({ page: pageNum, file: pageFile, dataUrl, text });
  }

  if (pages.length === 0) {
    throw new Error("This PDF has no pages to show.");
  }
  return pages;
}
