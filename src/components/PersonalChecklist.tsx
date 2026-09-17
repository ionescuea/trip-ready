"use client";

import type { CellStatus } from "@/lib/types";

type Item<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  title: string;
  subtitle?: string;
  items: Item<K>[];
  getStatus: (key: K) => CellStatus | undefined;
  onToggle: (key: K) => void;
  disabled?: boolean;
};

function labelFor(status: CellStatus | undefined) {
  switch (status) {
    case "done":
      return { text: "Ready", className: "pill ok" };
    case "attention":
      return { text: "Action needed", className: "pill warn" };
    case "na":
      return { text: "N/A", className: "pill" };
    default:
      return { text: "To do", className: "pill warn" };
  }
}

export function PersonalChecklist<K extends string>({
  title,
  subtitle,
  items,
  getStatus,
  onToggle,
  disabled = false,
}: Props<K>) {
  const done = items.filter((i) => getStatus(i.key) === "done").length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <p>
          {done} of {items.length} complete
          {subtitle ? ` · ${subtitle}` : ""}
        </p>
      </div>
      <div className="progress-track" aria-hidden>
        <div
          className="progress-fill"
          style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
        />
      </div>
      <ul className="check-list">
        {items.map((item) => {
          const status = getStatus(item.key) ?? "todo";
          const badge = labelFor(status);
          return (
            <li key={item.key}>
              <button
                type="button"
                className={`check-row cell-${status}${disabled ? " check-row-locked" : ""}`}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onToggle(item.key);
                }}
              >
                <span className="check-mark" aria-hidden>
                  {status === "done" ? "✓" : status === "attention" ? "!" : "○"}
                </span>
                <span className="check-label">{item.label}</span>
                <span className={badge.className}>{badge.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
