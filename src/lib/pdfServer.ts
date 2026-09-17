import { extractText, getDocumentProxy } from "unpdf";
import { normalizeExtractedText } from "@/lib/pdfText";

/**
 * Extract plain text from a PDF in Node (API routes).
 * Uses unpdf — works on Netlify/Lambda without the pdf.js worker bundle.
 */
export async function extractTextFromPdfBuffer(
  data: Uint8Array,
): Promise<string> {
  const pages = await extractTextPagesFromPdfBuffer(data);
  const text = normalizeExtractedText(pages.join("\n\n"));

  if (!text) {
    throw new Error(
      "No readable text in this PDF (it may be a scanned image). Paste the email text instead.",
    );
  }
  return text;
}

/** One string per PDF page (empty string if a page has no extractable text). */
export async function extractTextPagesFromPdfBuffer(
  data: Uint8Array,
): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const result = await extractText(pdf, { mergePages: false });
  const raw = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  return raw.map((p) => normalizeExtractedText(String(p ?? "")));
}
