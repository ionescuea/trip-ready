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

/** Update a traveller’s pick-up address and keep linked leave-by stops in sync. */
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
    };
  }

  const people = trip.people.map((person) =>
    person.id === personId ? { ...person, address } : person,
  );
  const person = people.find((p) => p.id === personId);
  let extraStops = (trip.extraStops ?? []).map((stop) =>
    stop.personId === personId ? { ...stop, address } : stop,
  );

  const trimmed = address.trim();
  const hasStop = extraStops.some((s) => s.personId === personId);
  if (trimmed && !hasStop && person) {
    const existingPickups = extraStops.filter((s) =>
      Boolean(s.personId || s.address?.trim()),
    ).length;
    extraStops = [
      ...extraStops,
      {
        id: newStopId(),
        label: `Pick up ${firstName(person.name)}`,
        // First passenger pick-up: no wait
        minutes: existingPickups === 0 ? 0 : 5,
        personId,
        address: trimmed,
      },
    ];
  }

  return { ...trip, people, extraStops };
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
  return { ...trip, people, extraStops };
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
