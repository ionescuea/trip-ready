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
  if (opts.isOwner || !opts.personId) return all;
  return all.filter(
    (t) => !t.personId || t.personId === opts.personId,
  );
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

export function isPdfTicket(ticket: TicketPass): boolean {
  return (
    ticket.mimeType === "application/pdf" ||
    /\.pdf$/i.test(ticket.fileName)
  );
}

export function isImageTicket(ticket: TicketPass): boolean {
  return ticket.mimeType.startsWith("image/");
}
