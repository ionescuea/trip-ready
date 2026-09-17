import type { TicketPass, Trip } from "@/lib/types";
import { nameTokens, normalizeName } from "@/lib/names";

function newId() {
  return `tkt_${Math.random().toString(36).slice(2, 10)}`;
}

export function ticketsOf(trip: Trip): TicketPass[] {
  return trip.tickets ?? [];
}

/**
 * Tickets visible to the current viewer.
 * - Owners: all (optionally filtered by filterPersonId)
 * - Travellers: only passes assigned to them (not “Everyone”)
 */
export function ticketsForViewer(
  trip: Trip,
  opts: {
    personId?: string | null;
    isOwner: boolean;
    /** Owner list filter — empty = show all */
    filterPersonId?: string | null;
  },
): TicketPass[] {
  const all = ticketsOf(trip);
  if (opts.isOwner) {
    const filter = opts.filterPersonId?.trim();
    if (!filter) return all;
    return all.filter((t) => t.personId === filter);
  }
  if (!opts.personId) return all;
  return all.filter((t) => t.personId === opts.personId);
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

/**
 * How strongly a boarding-pass page’s text matches a traveller name.
 * Prefers full name / surname+given (e.g. Elena Morosanu), not first name alone.
 */
export function scorePersonInPassText(pageText: string, personName: string): number {
  const hay = normalizeName(pageText).replace(/[^a-z0-9\s]/g, " ");
  const name = normalizeName(personName);
  if (!hay.trim() || !name) return 0;

  if (hay.includes(name)) return 100;

  // Airline layouts often use SURNAME/GIVEN or GIVEN/SURNAME without spaces
  const compactHay = hay.replace(/\s+/g, "");
  const compactName = name.replace(/\s+/g, "");
  if (compactName.length > 3 && compactHay.includes(compactName)) return 95;

  const tokens = nameTokens(personName).filter((t) => t.length > 1);
  if (!tokens.length) return 0;

  const hits = tokens.filter((t) => hay.includes(t) || compactHay.includes(t));
  if (hits.length === tokens.length) return 85;

  const surname = tokens[tokens.length - 1]!;
  const given = tokens.slice(0, -1);
  const surnameHit = hay.includes(surname) || compactHay.includes(surname);
  const givenHits = given.filter((t) => hay.includes(t) || compactHay.includes(t));

  if (surnameHit && givenHits.length > 0) return 75;
  // Surname + first initial: MOROSANU/E
  if (
    surnameHit &&
    given[0] &&
    (hay.includes(`${surname} ${given[0][0]}`) ||
      compactHay.includes(`${surname}${given[0][0]}`))
  ) {
    return 65;
  }
  return 0;
}

const MATCH_THRESHOLD = 65;

/** Best unique traveller match for one page of pass text. */
export function matchPersonFromPassText(
  pageText: string,
  people: { id: string; name: string }[],
  alreadyUsed: Set<string> = new Set(),
): string | null {
  const scored = people
    .filter((p) => !alreadyUsed.has(p.id) && p.name.trim())
    .map((p) => ({
      id: p.id,
      score: scorePersonInPassText(pageText, p.name),
    }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return scored[0]!.id;
}

export type PageForAssign = {
  page: number;
  text: string;
  file: File;
  dataUrl: string;
};

/**
 * Assign each PDF page to at most one traveller by the name printed on that page.
 * Keeps every matched page (e.g. outbound + return = 2 passes for the same person).
 * Unmatched pages are omitted — never guessed by roster order.
 */
export function assignPassPagesByName(
  pages: PageForAssign[],
  people: { id: string; name: string }[],
  opts?: { onlyPersonId?: string | null },
): { personId: string; personName: string; page: PageForAssign }[] {
  const pool = opts?.onlyPersonId
    ? people.filter((p) => p.id === opts.onlyPersonId)
    : people;

  const out: { personId: string; personName: string; page: PageForAssign }[] =
    [];

  for (const page of pages) {
    const scored = pool
      .map((person) => ({
        personId: person.id,
        personName: person.name.trim() || "Traveller",
        score: scorePersonInPassText(page.text, person.name),
      }))
      .filter((s) => s.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;
    // Skip ambiguous pages (two travellers score the same)
    if (scored.length > 1 && scored[0]!.score === scored[1]!.score) continue;

    const best = scored[0]!;
    out.push({
      personId: best.personId,
      personName: best.personName,
      page,
    });
  }

  return out;
}

export function withTicketsCleared(trip: Trip): Trip {
  return {
    ...trip,
    tickets: [],
    updatedAt: new Date().toISOString(),
  };
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
