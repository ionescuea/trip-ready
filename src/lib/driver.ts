import { peopleList } from "@/lib/bookingDetails";
import { findOwnerPerson } from "@/lib/cloudMeta";
import { findBestPersonMatch } from "@/lib/names";
import type { Person, Trip } from "@/lib/types";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** Resolve the trip driver (route start). */
export function getDriverPerson(trip: Trip): Person | undefined {
  if (trip.driverPersonId) {
    const linked = trip.people.find((p) => p.id === trip.driverPersonId);
    if (linked) return linked;
  }
  return inferDriverPerson(trip);
}

/** Guess driver from parking booking names, then trip owner. */
export function inferDriverPerson(trip: Trip): Person | undefined {
  if (trip.people.length === 0) return undefined;

  const parking = trip.bookings.find((b) => b.type === "parking");
  const fromField = peopleList(parking?.extracted.people);
  const fromRaw: string[] = [];
  const raw = parking?.rawText ?? "";
  const driverLine = raw.match(
    /(?:driver|lead\s*driver|registered\s*driver|vehicle\s*driver)\s*[:\-]\s*([^\n]{3,80})/i,
  );
  if (driverLine?.[1]) fromRaw.push(driverLine[1].trim());

  for (const name of [...fromRaw, ...fromField]) {
    const match = findBestPersonMatch(name, trip.people);
    if (match) return match;
  }

  return findOwnerPerson(trip.people) ?? trip.people[0];
}

export function getDriverStartAddress(trip: Trip): string {
  const driver = getDriverPerson(trip);
  return trip.homePostcode?.trim() || driver?.address?.trim() || "";
}

export function isDriverSetupComplete(trip: Trip): boolean {
  return Boolean(getDriverPerson(trip) && getDriverStartAddress(trip));
}

/** Travellers who may be pick-ups (everyone except the driver). */
export function passengersForPickup(trip: Trip): Person[] {
  const driverId = getDriverPerson(trip)?.id;
  return trip.people.filter((p) => p.id !== driverId);
}

export function driverDisplayName(trip: Trip): string {
  const d = getDriverPerson(trip);
  return d?.name.trim() || "Leave home";
}

export function driverFirstName(trip: Trip): string {
  const d = getDriverPerson(trip);
  return d ? firstName(d.name) : "Leave home";
}

/**
 * Set who drives. Syncs start address from their postcode when present,
 * and removes them from pick-up stops (they are the route origin).
 */
export function withDriver(trip: Trip, driverPersonId: string): Trip {
  const driver = trip.people.find((p) => p.id === driverPersonId);
  if (!driver) return trip;

  const homePostcode =
    driver.address?.trim() || trip.homePostcode?.trim() || trip.homePostcode;

  return {
    ...trip,
    driverPersonId,
    homePostcode: homePostcode || trip.homePostcode,
    extraStops: (trip.extraStops ?? []).filter((s) => s.personId !== driverPersonId),
    updatedAt: new Date().toISOString(),
  };
}

/** Keep driver’s address and home start in sync. */
export function withDriverStartAddress(trip: Trip, address: string): Trip {
  const driverId = trip.driverPersonId || getDriverPerson(trip)?.id;
  const people = driverId
    ? trip.people.map((p) => (p.id === driverId ? { ...p, address } : p))
    : trip.people;

  return {
    ...trip,
    homePostcode: address,
    people,
    extraStops: driverId
      ? (trip.extraStops ?? []).filter((s) => s.personId !== driverId)
      : trip.extraStops,
  };
}
