import { extractText, getDocumentProxy } from "unpdf";
import { normalizeExtractedText } from "@/lib/pdfText";

/**
 * Extract plain text from a PDF in Node (API routes).
 * Uses unpdf — works on Netlify/Lambda without the pdf.js worker bundle.
 */
export async function extractTextFromPdfBuffer(
  data: Uint8Array,
): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const result = await extractText(pdf, { mergePages: true });
  const raw = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  const text = normalizeExtractedText(String(raw ?? ""));

  if (!text) {
    throw new Error(
      "No readable text in this PDF (it may be a scanned image). Paste the email text instead.",
    );
  }
  return text;
}
