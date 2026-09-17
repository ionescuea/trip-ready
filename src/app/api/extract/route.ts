import { NextResponse } from "next/server";
import { EXTRACT_SYSTEM_PROMPT, normalizeAiBookings } from "@/lib/aiExtract";
import { extractAllFromText } from "@/lib/extract";

export const runtime = "nodejs";

function heuristic(text: string, note?: string) {
  const results = extractAllFromText(text);
  return NextResponse.json({
    source: "heuristic",
    results,
    note:
      note ||
      "Extracted with the built-in reader. Add OPENAI_API_KEY on Netlify for AI extract.",
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "No confirmation text provided." }, { status: 400 });
    }

    // Cap very large pastes
    const clipped = text.length > 60_000 ? text.slice(0, 60_000) : text;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return heuristic(clipped);
    }

    const model = process.env.OPENAI_EXTRACT_MODEL?.trim() || "gpt-4o-mini";

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Extract all bookings from this confirmation text:\n\n${clipped}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("OpenAI extract failed:", aiRes.status, errText.slice(0, 500));
      return heuristic(
        clipped,
        `Extracted with the built-in reader (AI returned ${aiRes.status}).`,
      );
    }

    const data = (await aiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return heuristic(clipped, "Extracted with the built-in reader (empty AI response).");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return heuristic(clipped, "Extracted with the built-in reader (AI JSON invalid).");
    }

    const results = normalizeAiBookings(parsed);
    if (results.length === 0) {
      return heuristic(clipped, "Extracted with the built-in reader (AI found no bookings).");
    }

    return NextResponse.json({
      source: "ai",
      results,
      note: `Extracted with AI (${model}). Check fields before relying on them.`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Extract failed." }, { status: 500 });
  }
}
