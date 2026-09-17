import type { Trip } from "./types";

const KEY = "trip-ready:v4";
const LEGACY_KEYS = [
  "trip-ready:v4",
  "trip-ready:v3",
  "trip-ready:v2",
  "trip-ready:v1",
  "trip-ready",
];

function isTripShape(value: unknown): value is Trip {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Trip>;
  return Array.isArray(t.people) && Array.isArray(t.bookings);
}

function tripWeight(trip: Trip): number {
  return (
    (trip.bookings?.length ?? 0) * 100 +
    (trip.people?.length ?? 0) * 10 +
    (trip.fromTown?.trim() ? 5 : 0) +
    (trip.toTown?.trim() ? 5 : 0) +
    (typeof trip.driveMinutes === "number" ? 3 : 0) +
    (trip.destination?.trim() ? 2 : 0)
  );
}

function parseTrip(raw: string | null): Trip | null {
  if (!raw) return null;
  try {
    const trip = JSON.parse(raw) as Trip;
    if (!isTripShape(trip)) return null;
    if (!trip.luggage) trip.luggage = {};
    if (!trip.checklist) trip.checklist = {};
    if (!trip.id) trip.id = `trip_${Date.now()}`;
    return trip;
  } catch {
    return null;
  }
}

/** Load the richest trip found across current + legacy keys. */
export function loadTrip(): Trip | null {
  if (typeof window === "undefined") return null;

  let best: Trip | null = null;
  let bestScore = -1;

  for (const key of LEGACY_KEYS) {
    try {
      const trip = parseTrip(localStorage.getItem(key));
      if (!trip) continue;
      const score = tripWeight(trip);
      if (score > bestScore) {
        best = trip;
        bestScore = score;
      }
    } catch {
      /* ignore bad key */
    }
  }

  // Also check session backup (survives some wipe races)
  try {
    const backup = parseTrip(sessionStorage.getItem("trip-ready:backup"));
    if (backup && tripWeight(backup) > bestScore) {
      best = backup;
    }
  } catch {
    /* ignore */
  }

  return best;
}

/**
 * Persist trip. Refuses to replace a saved trip that has bookings/people
 * with an empty shell (guards against load/save races).
 */
export function saveTrip(trip: Trip): void {
  if (typeof window === "undefined") return;
  if (!isTripShape(trip)) return;

  try {
    const incoming = tripWeight(trip);
    const existingRaw = localStorage.getItem(KEY);
    const existing = parseTrip(existingRaw);
    if (existing && tripWeight(existing) >= 100 && incoming === 0) {
      console.warn("[trip-ready] Refused to overwrite saved trip with an empty one.");
      return;
    }
    // Don't clobber a heavier trip with a much emptier one
    if (existing && tripWeight(existing) > incoming + 50 && incoming < 50) {
      console.warn("[trip-ready] Refused to overwrite richer saved trip with thinner state.");
      return;
    }

    const payload = JSON.stringify({ ...trip, updatedAt: new Date().toISOString() });
    localStorage.setItem(KEY, payload);
    sessionStorage.setItem("trip-ready:backup", payload);
  } catch (err) {
    console.error("[trip-ready] Failed to save trip", err);
  }
}

export function clearTrip(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  try {
    sessionStorage.removeItem("trip-ready:backup");
  } catch {
    /* ignore */
  }
}
