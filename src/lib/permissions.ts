import type { CloudMeta } from "@/lib/cloudMeta";

/** Organiser of a cloud trip. Guests (no meta) cannot edit. */
export function isTripOwner(meta: CloudMeta | null | undefined): boolean {
  if (!meta?.tripId) return false;
  return meta.role !== "traveller";
}

export function isTravellerMember(meta: CloudMeta | null | undefined): boolean {
  return meta?.role === "traveller";
}

export function isSignedInToTrip(meta: CloudMeta | null | undefined): boolean {
  return Boolean(meta?.tripId);
}

/** Bookings, leave-by, travellers list, trip settings — organiser only. */
export function canEditTripStructure(meta: CloudMeta | null | undefined): boolean {
  return isTripOwner(meta);
}

/** Documents / luggage / readiness cells for a person. */
export function canEditPersonChecks(
  meta: CloudMeta | null | undefined,
  personId: string,
): boolean {
  if (!meta?.tripId) return false;
  if (isTripOwner(meta)) return true;
  return Boolean(meta.personId && meta.personId === personId);
}

/** Owner editing someone else’s checklist (accidental-click risk). */
export function isOwnerEditingOther(
  meta: CloudMeta | null | undefined,
  personId: string,
): boolean {
  if (!isTripOwner(meta)) return false;
  if (!meta?.personId) return false;
  return meta.personId !== personId;
}

export function confirmOwnerEditOther(personName: string): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(
    `You’re about to change ${personName}’s list.\n\nOnly do this if they asked you to — cancel if you tapped by mistake.`,
  );
}
