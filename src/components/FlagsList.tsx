"use client";

import type { Flag } from "@/lib/types";

type Props = {
  flags: Flag[];
};

export function FlagsList({ flags }: Props) {
  const red = flags.filter((f) => f.severity === "red").length;
  const yellow = flags.filter((f) => f.severity === "yellow").length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Issues</h2>
        {flags.length > 0 ? (
          <p>
            {red} red · {yellow} yellow
          </p>
        ) : null}
      </div>
      {flags.length === 0 ? null : (
        <ul className="flags">
          {flags.map((f) => (
            <li key={f.id} className={`flag flag-${f.severity}`}>
              <strong>{f.title}</strong>
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
