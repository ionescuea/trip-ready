import type { Person, Trip } from "@/lib/types";

const META_KEY = "trip-ready:cloud";

export type CloudMeta = {
  tripId: string;
  inviteCode: string;
  /** Which Trip.people[].id this device/user is */
  personId?: string;
  role?: "owner" | "traveller";
  /**
   * Email-only traveller access (no Supabase login).
   * Invite code + this email must match a person on the trip.
   */
  travellerEmail?: string;
  /**
   * Email-only organiser access (no magic link).
   * Must match trip.organiserEmail.
   */
  organiserEmail?: string;
};

/** Traveller joined with invite code + email (no magic link). */
export function isEmailTravellerMeta(meta: CloudMeta | null | undefined): boolean {
  return Boolean(
    meta?.role === "traveller" &&
      meta.travellerEmail?.trim() &&
      meta.inviteCode &&
      meta.tripId &&
      meta.personId,
  );
}

/** Organiser access with email only (no magic link). */
export function isEmailOrganiserMeta(meta: CloudMeta | null | undefined): boolean {
  return Boolean(
    meta?.role === "owner" &&
      meta.organiserEmail?.trim() &&
      meta.inviteCode &&
      meta.tripId,
  );
}

/** Any email-only session (organiser or traveller) — no Supabase Auth user. */
export function isEmailAccessMeta(meta: CloudMeta | null | undefined): boolean {
  return isEmailTravellerMeta(meta) || isEmailOrganiserMeta(meta);
}

export const OWNER_FULL_NAME = "Elena-Alexandra Ionescu";

/** Prefer Elena-Alexandra Ionescu as the trip owner / “who I am” default. */
export function findOwnerPerson(people: Person[]): Person | undefined {
  const preferred = [
    OWNER_FULL_NAME,
    "Elena Alexandra Ionescu",
    "Elena-Alexandra",
    "Elena Ionescu",
  ];

  for (const name of preferred) {
    const hit = people.find(
      (p) => normalizeName(p.name) === normalizeName(name),
    );
    if (hit) return hit;
  }

  const ionescu = people.find((p) => {
    const tokens = nameTokens(p.name);
    return tokens.includes("ionescu") && tokens.includes("elena");
  });
  if (ionescu) return ionescu;

  const compound = people.find((p) => {
    const n = normalizeName(p.name);
    return n.includes("elena-alexandra") || n.includes("elena alexandra");
  });
  if (compound) return compound;

  return people[0];
}

/**
 * If the owner is Elena Ionescu without Alexandra, rename to Elena-Alexandra Ionescu
 * so she’s not confused with Elena Morosanu.
 */
export function withOwnerFullName(trip: Trip): Trip {
  const owner = findOwnerPerson(trip.people);
  if (!owner) return trip;
  const tokens = nameTokens(owner.name);
  const isIonescuElena =
    tokens.includes("ionescu") && tokens.includes("elena");
  const hasAlexandra = tokens.includes("alexandra");
  if (!isIonescuElena) return trip;
  if (hasAlexandra && owner.name.includes("-")) return trip;
  if (normalizeName(owner.name) === normalizeName(OWNER_FULL_NAME)) return trip;

  return {
    ...trip,
    people: trip.people.map((p) =>
      p.id === owner.id ? { ...p, name: OWNER_FULL_NAME } : p,
    ),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeName(name?: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name?: string): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  return n
    .split(/[\s\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

export function loadCloudMeta(): CloudMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as CloudMeta;
    if (!meta.tripId || !meta.inviteCode) return null;
    return meta;
  } catch {
    return null;
  }
}

export function saveCloudMeta(meta: CloudMeta | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!meta) localStorage.removeItem(META_KEY);
    else localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export function makeInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Prefer newer updatedAt; if equal, keep local. */
export function pickNewerTrip(local: Trip, remote: Trip): Trip {
  const a = Date.parse(local.updatedAt || "") || 0;
  const b = Date.parse(remote.updatedAt || "") || 0;
  return b > a ? remote : local;
}
