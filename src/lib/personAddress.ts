import {
  getDriverPerson,
} from "@/lib/driver";
import type { ExtraStop, Person, Trip } from "./types";

function newStopId() {
  return `stop_${Math.random().toString(36).slice(2, 9)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/**
 * Rebuild traveller pick-up stops from saved people[].address.
 * Preserves map / nearest-first order already on extraStops; petrol stays at the end.
 */
export function reconcilePickupStops(trip: Trip): Trip {
  const driverId = getDriverPerson(trip)?.id;
  const customStops = (trip.extraStops ?? []).filter((s) => !s.personId);
  const passengers = trip.people.filter(
    (p) => p.id !== driverId && p.address?.trim(),
  );
  const byId = new Map(passengers.map((p) => [p.id, p]));

  // Keep existing pick-up sequence (geocode sorts nearest → furthest from start)
  const kept: ExtraStop[] = [];
  const seen = new Set<string>();
  for (const stop of trip.extraStops ?? []) {
    if (!stop.personId || seen.has(stop.personId)) continue;
    const person = byId.get(stop.personId);
    if (!person) continue;
    kept.push({
      ...stop,
      label: `Pick up ${firstName(person.name)}`,
      address: person.address!.trim(),
    });
    seen.add(stop.personId);
  }

  // Append newly addressed passengers (not yet on the route)
  for (const person of passengers) {
    if (seen.has(person.id)) continue;
    kept.push({
      id: newStopId(),
      label: `Pick up ${firstName(person.name)}`,
      minutes: 5,
      personId: person.id,
      address: person.address!.trim(),
    });
    seen.add(person.id);
  }

  // Traveller pick-ups always carry a 5 min dwell (included in leave-by total)
  const pickupStops = kept.map((stop) => ({
    ...stop,
    minutes: stop.minutes > 0 ? stop.minutes : 5,
  }));

  const nextStops = [...pickupStops, ...customStops];
  const prev = trip.extraStops ?? [];
  const same =
    prev.length === nextStops.length &&
    prev.every((s, i) => {
      const n = nextStops[i];
      return (
        n &&
        s.id === n.id &&
        s.personId === n.personId &&
        s.address === n.address &&
        s.label === n.label &&
        s.minutes === n.minutes
      );
    });
  if (same) return trip;

  return {
    ...trip,
    extraStops: nextStops,
    updatedAt: new Date().toISOString(),
  };
}

/** Update a traveller’s pick-up address and keep leave-by stops in sync. */
export function withPersonAddress(
  trip: Trip,
  personId: string,
  address: string,
): Trip {
  const driverId = getDriverPerson(trip)?.id;
  // Driver address is the route start — not a pick-up stop
  if (driverId && personId === driverId) {
    return {
      ...trip,
      homePostcode: address,
      people: trip.people.map((person) =>
        person.id === personId ? { ...person, address } : person,
      ),
      extraStops: (trip.extraStops ?? []).filter((s) => s.personId !== personId),
      updatedAt: new Date().toISOString(),
    };
  }

  const people = trip.people.map((person) =>
    person.id === personId ? { ...person, address } : person,
  );

  return reconcilePickupStops({
    ...trip,
    people,
    updatedAt: new Date().toISOString(),
  });
}

export function withPersonName(trip: Trip, personId: string, name: string): Trip {
  const people = trip.people.map((person) =>
    person.id === personId ? { ...person, name } : person,
  );
  const first = name.trim().split(/\s+/)[0];
  const extraStops = (trip.extraStops ?? []).map((stop) => {
    if (stop.personId !== personId) return stop;
    if (!/^pick\s*up\b/i.test(stop.label.trim()) && stop.label.trim()) return stop;
    return {
      ...stop,
      label: first ? `Pick up ${first}` : stop.label,
    };
  });
  return { ...trip, people, extraStops, updatedAt: new Date().toISOString() };
}

export function personAddressLabel(person: Person): string {
  const a = person.address?.trim();
  return a || "No pick-up address";
}

export function stopUsesPersonAddress(
  stop: ExtraStop,
  people: Person[],
): string {
  if (stop.address?.trim()) return stop.address.trim();
  if (!stop.personId) return "";
  return people.find((p) => p.id === stop.personId)?.address?.trim() ?? "";
}
