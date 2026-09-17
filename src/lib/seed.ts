import type { ChecklistState, LuggageState, Person, Trip } from "./types";
import { LUGGAGE_ROWS } from "./types";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function blankChecklist(people: Person[]): ChecklistState {
  const checklist: ChecklistState = {};
  for (const person of people) {
    checklist[person.id] = {
      on_flight: "todo",
      on_hotel: "todo",
      paid: "todo",
      check_in: "todo",
      tickets_wallet: "todo",
      passport_packed: "todo",
      passport_rules: "todo",
      visa: "todo",
      cabin_bag: "todo",
      hold_bag: "todo",
    };
  }
  return checklist;
}

function blankLuggage(people: Person[]): LuggageState {
  const luggage: LuggageState = {};
  for (const person of people) {
    luggage[person.id] = Object.fromEntries(
      LUGGAGE_ROWS.map((r) => [r.key, "todo" as const]),
    );
  }
  return luggage;
}

/** Empty trip for real bookings — no demo samples. */
export function createBlankTrip(): Trip {
  return {
    id: id("trip"),
    name: "My trip",
    destination: "",
    startDate: "",
    endDate: "",
    fromTown: "",
    toTown: "",
    homePostcode: "",
    driverPersonId: undefined,
    driveMinutes: undefined,
    driveDistanceKm: undefined,
    parkingMinutes: undefined,
    extraStops: [],
    people: [],
    bookings: [],
    checklist: {},
    luggage: {},
    updatedAt: new Date().toISOString(),
  };
}

export function peopleFromNames(names: string[]): Person[] {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => ({ id: id("p"), name }));
}

export function withChecklistForPeople(people: Person[], existing?: ChecklistState): ChecklistState {
  const next = blankChecklist(people);
  if (!existing) return next;
  for (const person of people) {
    if (existing[person.id]) next[person.id] = { ...next[person.id], ...existing[person.id] };
  }
  return next;
}

export function withLuggageForPeople(people: Person[], existing?: LuggageState): LuggageState {
  const next = blankLuggage(people);
  if (!existing) return next;
  for (const person of people) {
    if (existing[person.id]) next[person.id] = { ...next[person.id], ...existing[person.id] };
  }
  return next;
}
