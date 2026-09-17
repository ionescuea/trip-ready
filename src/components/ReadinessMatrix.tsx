"use client";

import {
  CHECKLIST_ROWS,
  type CellStatus,
  type ChecklistKey,
  type Trip,
} from "@/lib/types";

type Props = {
  trip: Trip;
  onToggle: (personId: string, key: ChecklistKey) => void;
  /** When false, cell is view-only. Defaults to editable. */
  canEditPerson?: (personId: string) => boolean;
};

const CYCLE: CellStatus[] = ["todo", "done", "attention", "na"];

function nextStatus(current: CellStatus | undefined): CellStatus {
  const i = CYCLE.indexOf(current ?? "todo");
  return CYCLE[(i + 1) % CYCLE.length];
}

function symbol(status: CellStatus | undefined) {
  switch (status) {
    case "done":
      return "✓";
    case "attention":
      return "!";
    case "na":
      return "—";
    default:
      return "○";
  }
}

export function ReadinessMatrix({ trip, onToggle, canEditPerson }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Group readiness</h2>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Check</th>
              {trip.people.map((p) => (
                <th key={p.id} scope="col">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHECKLIST_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {trip.people.map((p) => {
                  const status = trip.checklist[p.id]?.[row.key] ?? "todo";
                  const editable = canEditPerson ? canEditPerson(p.id) : true;
                  return (
                    <td key={p.id}>
                      <button
                        type="button"
                        className={`cell cell-${status}${editable ? "" : " cell-locked"}`}
                        title={
                          editable
                            ? `Mark ${row.label} for ${p.name}`
                            : `${p.name} — view only`
                        }
                        disabled={!editable}
                        onClick={() => {
                          if (!editable) return;
                          onToggle(p.id, row.key);
                        }}
                      >
                        {symbol(status)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export { nextStatus };
