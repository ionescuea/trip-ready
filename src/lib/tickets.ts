import type { TicketPass, Trip } from "@/lib/types";

function newId() {
  return `tkt_${Math.random().toString(36).slice(2, 10)}`;
}

export function ticketsOf(trip: Trip): TicketPass[] {
  return trip.tickets ?? [];
}

/** Tickets visible to a traveller (or all if owner / no person filter). */
export function ticketsForViewer(
  trip: Trip,
  opts: { personId?: string | null; isOwner: boolean },
): TicketPass[] {
  const all = ticketsOf(trip);
  // Owners always see every pass. Travellers without a linked profile also see all
  // (so they aren’t locked out before Account → “I am”).
  if (opts.isOwner || !opts.personId) return all;
  return all.filter((t) => {
    const assigned = t.personId?.trim();
    if (!assigned) return true; // Everyone
    return assigned === opts.personId;
  });
}

export function ticketPersonLabel(trip: Trip, ticket: TicketPass): string {
  if (!ticket.personId) return "Everyone";
  return (
    trip.people.find((p) => p.id === ticket.personId)?.name.trim() || "Traveller"
  );
}

export function withTicketAdded(trip: Trip, ticket: TicketPass): Trip {
  return {
    ...trip,
    tickets: [...ticketsOf(trip), ticket],
    updatedAt: new Date().toISOString(),
  };
}

export function withTicketUpdated(
  trip: Trip,
  ticketId: string,
  patch: Partial<TicketPass>,
): Trip {
  return {
    ...trip,
    tickets: ticketsOf(trip).map((t) =>
      t.id === ticketId ? { ...t, ...patch } : t,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function withTicketRemoved(trip: Trip, ticketId: string): Trip {
  return {
    ...trip,
    tickets: ticketsOf(trip).filter((t) => t.id !== ticketId),
    updatedAt: new Date().toISOString(),
  };
}

export function createTicketMeta(opts: {
  label: string;
  fileName: string;
  mimeType: string;
  personId?: string | null;
  storagePath?: string;
  dataUrl?: string;
}): TicketPass {
  return {
    id: newId(),
    label: opts.label.trim() || opts.fileName,
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    personId: opts.personId || null,
    storagePath: opts.storagePath,
    dataUrl: opts.dataUrl,
    createdAt: new Date().toISOString(),
  };
}

/** Match boarding-pass page text to a roster person (unique best match). */
export function matchPersonFromPassText(
  pageText: string,
  people: { id: string; name: string }[],
  alreadyUsed: Set<string>,
): string | null {
  const hay = pageText.toLowerCase();
  if (!hay.trim() || people.length === 0) return null;

  const scored: { id: string; score: number }[] = [];
  for (const p of people) {
    if (alreadyUsed.has(p.id)) continue;
    const name = p.name.trim();
    if (!name) continue;
    const norm = name.toLowerCase();
    let score = 0;
    if (hay.includes(norm)) score += 10;
    const parts = norm.split(/[\s\-]+/).filter((t) => t.length > 2);
    for (const part of parts) {
      if (hay.includes(part)) score += 3;
    }
    if (score > 0) scored.push({ id: p.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return scored[0]!.id;
}

export function withTicketsAdded(trip: Trip, tickets: TicketPass[]): Trip {
  return {
    ...trip,
    tickets: [...ticketsOf(trip), ...tickets],
    updatedAt: new Date().toISOString(),
  };
}

export function isPdfTicket(ticket: TicketPass): boolean {
  return (
    ticket.mimeType === "application/pdf" ||
    /\.pdf$/i.test(ticket.fileName)
  );
}

export function isImageTicket(ticket: TicketPass): boolean {
  return ticket.mimeType.startsWith("image/");
}
