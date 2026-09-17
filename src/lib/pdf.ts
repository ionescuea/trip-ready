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

/** Extract plain text from a PDF File in the browser (PDF.js). */
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");

  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

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

async function configurePdfWorker() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

/**
 * Rasterise a PDF (signed URL or data URL) to PNG data URLs for in-app viewing.
 * Used by Wallet — phones often show a blank page for PDF iframes.
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
  const scale = opts?.scale ?? 2;
  const pdf = await pdfjs.getDocument({ data }).promise;
  const images: string[] = [];
  const limit = Math.min(pdf.numPages, maxPages);

  for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) {
      throw new Error("Could not draw the boarding pass.");
    }
    await page.render({ canvasContext, canvas, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.92));
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
  const scale = opts?.scale ?? 2.25;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const limit = Math.min(pdf.numPages, maxPages);
  const pages: SplitPdfPage[] = [];
  const base = file.name.replace(/\.pdf$/i, "") || "boarding-pass";

  for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext("2d");
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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const blob = await (await fetch(dataUrl)).blob();
    const pageFile = new File([blob], `${base}-p${pageNum}.jpg`, {
      type: "image/jpeg",
    });
    pages.push({ page: pageNum, file: pageFile, dataUrl, text });
  }

  if (pages.length === 0) {
    throw new Error("This PDF has no pages to show.");
  }
  return pages;
}
