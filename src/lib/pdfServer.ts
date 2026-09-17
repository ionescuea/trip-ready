import { normalizeExtractedText } from "@/lib/pdfText";

type TextItem = {
  str?: string;
  hasEOL?: boolean;
};

/**
 * Extract plain text from a PDF in Node (API routes).
 * Avoids the mobile-browser PDF.js worker issues that break hotel/flight uploads.
 */
export async function extractTextFromPdfBuffer(
  data: Uint8Array,
): Promise<string> {
  // Legacy build works in Node without a browser worker.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = Array.isArray(content.items) ? content.items : [];
    const parts: string[] = [];
    for (const raw of items) {
      const item = raw as TextItem;
      if (!item?.str) continue;
      parts.push(item.str);
      if (item.hasEOL) parts.push("\n");
      else parts.push(" ");
    }
    const pageText = parts.join("").replace(/[ \t]+\n/g, "\n").trim();
    if (pageText) pages.push(pageText);
  }

  const text = normalizeExtractedText(pages.join("\n\n"));
  if (!text) {
    throw new Error(
      "No readable text in this PDF (it may be a scanned image). Paste the email text instead.",
    );
  }
  return text;
}
