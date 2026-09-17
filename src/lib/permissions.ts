import type { CloudMeta } from "@/lib/cloudMeta";

/** Local / unlinked devices act as owner (organizer). */
export function isTripOwner(meta: CloudMeta | null | undefined): boolean {
  if (!meta) return true;
  return meta.role !== "traveller";
}

export function isTravellerMember(meta: CloudMeta | null | undefined): boolean {
  return meta?.role === "traveller";
}

/** Bookings, leave-by, travellers list, trip settings. */
export function canEditTripStructure(meta: CloudMeta | null | undefined): boolean {
  return isTripOwner(meta);
}

/** Documents / luggage / readiness cells for a person. */
export function canEditPersonChecks(
  meta: CloudMeta | null | undefined,
  personId: string,
): boolean {
  if (isTripOwner(meta)) return true;
  return Boolean(meta?.personId && meta.personId === personId);
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
