import type { Person } from "./types";

/** Lowercase, collapse spaces, unify hyphens/apostrophes for comparison. */
export function normalizeName(name?: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokens from a display name.
 * "Elena-Alexandra Popescu" → ["elena", "alexandra", "popescu"]
 * "Elena Alexandra" → ["elena", "alexandra"]
 */
export function nameTokens(name?: string): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  return n
    .split(/[\s\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/** Avatar letters — splits hyphens too (Elena-Alexandra Ionescu → EAI). */
export function nameInitials(name?: string, max = 3): string {
  const tokens = nameTokens(name);
  if (!tokens.length) return "TR";
  return tokens
    .map((t) => t[0]!.toUpperCase())
    .join("")
    .slice(0, max);
}

/**
 * Flexible name match for bookings that only print a first name / truncate compounds.
 * Examples that match:
 *  - "Elena" ↔ "Elena-Alexandra"
 *  - "Elena Alexandra" ↔ "Elena-Alexandra Popescu"
 */
export function namesMatch(a?: string, b?: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;

  // Same first given name (handles hyphenated compounds on either side)
  if (ta[0] === tb[0]) return true;

  // Shorter token list is a subset of the longer (order-insensitive)
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.includes(t));
}

/**
 * Stricter than namesMatch — for merging duplicate roster rows.
 * "Elena" + "Elena-Alexandra" → same person.
 * "John Smith" + "John Doe" → NOT the same (shared first name only).
 */
export function samePersonLikely(a?: string, b?: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;

  // One side is a single given name / first token of the other
  if (ta.length === 1 && tb[0] === ta[0]) return true;
  if (tb.length === 1 && ta[0] === tb[0]) return true;

  // Hyphenated compound shares first token with a short name already handled;
  // multi-token: require shorter ⊆ longer
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length >= 2 && shorter.every((t) => longer.includes(t))) return true;

  return false;
}

export type NameMatchScore = {
  person: Person;
  score: number;
};

/**
 * Score how well a booking name fits a roster person.
 * Higher = better. 0 = no match.
 */
export function scoreNameMatch(bookingName: string, personName: string): number {
  if (!namesMatch(bookingName, personName)) return 0;

  const nb = normalizeName(bookingName);
  const np = normalizeName(personName);
  if (nb === np) return 100;

  const tb = nameTokens(bookingName);
  const tp = nameTokens(personName);

  let score = 40;
  // Prefer fuller roster names when booking is abbreviated (Elena → Elena-Alexandra)
  if (tp.length > tb.length) score += 20;
  if (tp[0] === tb[0]) score += 15;
  // Shared tokens beyond the first
  const shared = tb.filter((t) => tp.includes(t)).length;
  score += shared * 10;
  // Slight preference for hyphenated compounds when booking is a single token
  if (tb.length === 1 && /-/i.test(personName)) score += 8;
  // Length similarity bonus
  score += Math.max(0, 10 - Math.abs(np.length - nb.length));

  return score;
}

/**
 * Pick the best roster person for a booking name.
 * If two people could match equally (two "Elena"s), returns null so we don't guess wrong.
 */
export function findBestPersonMatch(
  bookingName: string,
  people: Person[],
): Person | null {
  const scored = people
    .map((person) => ({ person, score: scoreNameMatch(bookingName, person.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length === 1) return scored[0].person;

  // Clear winner
  if (scored[0].score >= scored[1].score + 10) return scored[0].person;

  // Tie between a short name and a hyphenated compound starting with same first name:
  // prefer the compound (booking said "Elena", roster has "Elena" + "Elena-Alexandra")
  const first = nameTokens(bookingName)[0];
  const compounds = scored.filter(
    (s) => nameTokens(s.person.name)[0] === first && /-/i.test(s.person.name),
  );
  const plains = scored.filter(
    (s) => nameTokens(s.person.name)[0] === first && !/-/i.test(s.person.name),
  );
  if (compounds.length === 1 && plains.length >= 1 && nameTokens(bookingName).length === 1) {
    return compounds[0].person;
  }

  // Still ambiguous
  return null;
}

/**
 * Is this roster person covered by any booking name?
 */
export function personCoveredByBookingNames(
  personName: string,
  bookingNames: string[],
): boolean {
  return bookingNames.some((b) => namesMatch(personName, b));
}

/**
 * Merge duplicate roster entries (e.g. "Elena" + "Elena-Alexandra" → keep hyphenated).
 * Returns people list + map of removedId → keptId for checklist/luggage merge.
 */
export function dedupeRosterPeople(people: Person[]): {
  people: Person[];
  idMap: Record<string, string>;
} {
  const idMap: Record<string, string> = {};
  const kept: Person[] = [];

  for (const person of people) {
    const matchIdx = kept.findIndex((k) => samePersonLikely(k.name, person.name));
    if (matchIdx < 0) {
      kept.push(person);
      continue;
    }

    const existing = kept[matchIdx];
    const preferNew =
      nameTokens(person.name).length > nameTokens(existing.name).length ||
      (/-/i.test(person.name) && !/-/i.test(existing.name)) ||
      person.name.trim().length > existing.name.trim().length;

    if (preferNew) {
      idMap[existing.id] = person.id;
      kept[matchIdx] = person;
    } else {
      idMap[person.id] = existing.id;
    }
  }

  return { people: kept, idMap };
}

/**
 * Merge booking-extracted names into the trip roster without duplicating
 * "Elena" when "Elena-Alexandra" already exists.
 */
export function mergePeopleNames(
  existing: Person[],
  bookingNames: string[],
  makeId: () => string,
): Person[] {
  const people = [...existing];
  const claimed = new Set<string>();

  for (const raw of bookingNames) {
    const bookingName = raw.trim();
    if (!bookingName) continue;

    const available = people.filter((p) => !claimed.has(p.id));
    const match = findBestPersonMatch(bookingName, available);
    if (match) {
      claimed.add(match.id);
      if (
        nameTokens(bookingName).length > nameTokens(match.name).length ||
        (/-/i.test(bookingName) && !/-/i.test(match.name))
      ) {
        const idx = people.findIndex((p) => p.id === match.id);
        if (idx >= 0) people[idx] = { ...people[idx], name: bookingName };
      }
      continue;
    }

    const already = people.some((p) => samePersonLikely(p.name, bookingName));
    if (!already) {
      const person = { id: makeId(), name: bookingName };
      people.push(person);
      claimed.add(person.id);
    }
  }

  return dedupeRosterPeople(people).people;
}

/** Claim unique roster people for each booking name (no double-counting). */
export function claimPeopleForBookingNames(
  people: Person[],
  bookingNames: string[],
): Set<string> {
  const claimed = new Set<string>();
  for (const bn of bookingNames) {
    const match = findBestPersonMatch(
      bn,
      people.filter((p) => !claimed.has(p.id)),
    );
    if (match) claimed.add(match.id);
  }
  return claimed;
}
