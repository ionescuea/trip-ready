"use client";

import { useCallback, useState } from "react";
import { extractTextFromPdf } from "@/lib/pdf";

type Props = {
  onText: (text: string, sourceName: string) => void | Promise<void>;
  busy?: boolean;
};

export function DropZone({ onText, busy = false }: Props) {
  const [dragging, setDragging] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const locked = reading || busy;

  const readFile = useCallback(
    async (file: File) => {
      setError(null);
      const name = file.name;
      setReading(true);
      try {
        let text = "";
        if (file.type.startsWith("text/") || name.endsWith(".eml") || name.endsWith(".txt")) {
          text = await file.text();
        } else if (file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
          text = await extractTextFromPdf(file);
        } else {
          try {
            text = await file.text();
          } catch {
            /* ignore */
          }
        }
        if (!text.trim()) {
          setError("Could not read that file. Try a PDF, .txt, .eml, or paste the text below.");
          return;
        }
        await onText(text, name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that PDF.");
      } finally {
        setReading(false);
      }
    },
    [onText],
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Drop confirmations</h2>
      </div>

      <div
        className={`drop ${dragging ? "drop-active" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (locked) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
      >
        <strong>{busy ? "Extracting…" : reading ? "Reading file…" : "Drag & drop"}</strong>
        <span>PDF, .txt, or .eml</span>
        <label className={`file-btn ${locked ? "disabled" : ""}`}>
          Choose file
          <input
            type="file"
            accept=".pdf,.txt,.eml,application/pdf,text/plain"
            hidden
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <label className="field">
        <span>Or paste email text</span>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={6}
          placeholder="Paste the full confirmation email here…"
          disabled={locked}
        />
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!paste.trim() || locked}
        onClick={() => {
          const value = paste;
          setPaste("");
          setError(null);
          void (async () => {
            try {
              await onText(value, "pasted-email.txt");
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not extract that text.",
              );
            }
          })();
        }}
      >
        {busy ? "Extracting…" : "Extract from paste"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
