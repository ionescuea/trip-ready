import { NextResponse } from "next/server";
import { extractTextFromPdfBuffer } from "@/lib/pdfServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No PDF file uploaded." }, { status: 400 });
    }

    const name = file.name || "document.pdf";
    const isPdf =
      file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        { error: "Please upload a PDF confirmation." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "PDF is too large (max 12 MB). Try a smaller file or paste the text." },
        { status: 400 },
      );
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const text = await extractTextFromPdfBuffer(data);

    return NextResponse.json({ text, sourceName: name });
  } catch (err) {
    console.error("pdf-text failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : "Could not read that PDF. Paste the confirmation email instead.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
