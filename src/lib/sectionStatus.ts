import { computeLeaveBy } from "./leaveBy";
import type { Flag, Trip } from "./types";
import { DOCUMENT_ROWS, LUGGAGE_ROWS } from "./types";

export type SectionTone = "green" | "yellow" | "red";

export type SectionStatus = {
  tone: SectionTone;
  label: string;
};

function worst(a: SectionTone, b: SectionTone): SectionTone {
  const rank = { green: 0, yellow: 1, red: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** Bookings card: need confirmed flight + hotel + parking when relevant. */
export function bookingsSectionStatus(trip: Trip): SectionStatus {
  const flight = trip.bookings.find((b) => b.type === "flight");
  const hotel = trip.bookings.find((b) => b.type === "hotel");
  const parking = trip.bookings.find((b) => b.type === "parking");

  if (!flight && !hotel && !parking) {
    return { tone: "red", label: "No bookings yet" };
  }

  const missing: string[] = [];
  if (!flight) missing.push("flight");
  if (!hotel) missing.push("hotel");
  if (!parking) missing.push("parking");

  if (parking && !parking.extracted.routeStart) {
    return { tone: "red", label: "Tick parking starting point" };
  }

  const unconfirmed = trip.bookings.filter((b) => !b.confirmed);
  if (missing.length === 3) {
    return { tone: "red", label: "Add confirmations" };
  }
  if (missing.length > 0) {
    return {
      tone: "yellow",
      label: `Missing ${missing.join(" · ")}`,
    };
  }
  if (unconfirmed.length > 0) {
    return {
      tone: "yellow",
      label: `${unconfirmed.length} need check`,
    };
  }
  return { tone: "green", label: "Flight · Hotel · Parking" };
}

/** Leave-by card: driver, start postcode, drive estimate, flight time. */
export function leaveBySectionStatus(trip: Trip): SectionStatus {
  const flight = trip.bookings.find((b) => b.type === "flight");
  const hasDepart = Boolean(flight?.extracted.startDate && flight?.extracted.startTime);
  const hasDriver = Boolean(trip.driverPersonId);
  const hasStart = Boolean(trip.homePostcode?.trim());
  const hasFrom = Boolean(trip.fromTown?.trim());
  const hasTo = Boolean(trip.toTown?.trim() || trip.bookings.some((b) => b.type === "parking"));
  const hasDrive = typeof trip.driveMinutes === "number" && trip.driveMinutes > 0;

  if (!hasDepart) {
    return { tone: "red", label: "Need flight departure time" };
  }
  if (!hasDriver || !hasStart) {
    return { tone: "red", label: "Set driver & start postcode" };
  }
  if (!hasFrom || !hasTo) {
    return { tone: "yellow", label: "Add travelling from / to" };
  }
  if (!hasDrive) {
    return { tone: "yellow", label: "Estimate the drive" };
  }

  const plan = computeLeaveBy(trip);
  if (!plan.leaveHomeAt || !plan.parkingArriveBy) {
    return { tone: "yellow", label: "Leave-by incomplete" };
  }
  return { tone: "green", label: "Leave-by calculated" };
}

/** Group readiness: based on flags. */
export function readinessSectionStatus(flags: Flag[]): SectionStatus {
  const red = flags.filter((f) => f.severity === "red").length;
  const yellow = flags.filter((f) => f.severity === "yellow").length;
  if (red > 0) {
    return {
      tone: "red",
      label: `${red} red flag${red === 1 ? "" : "s"} to fix`,
    };
  }
  if (yellow > 0) {
    return {
      tone: "yellow",
      label: `${yellow} flag${yellow === 1 ? "" : "s"} to review`,
    };
  }
  return { tone: "green", label: "No flags" };
}

/** Travellers & packing: people exist + docs/luggage progress. */
export function travellersSectionStatus(trip: Trip): SectionStatus {
  if (trip.people.length === 0) {
    return { tone: "red", label: "Add travellers" };
  }

  let todo = 0;
  let attention = 0;
  let done = 0;
  let total = 0;

  for (const person of trip.people) {
    for (const row of DOCUMENT_ROWS) {
      total += 1;
      const s = trip.checklist[person.id]?.[row.key] ?? "todo";
      if (s === "done" || s === "na") done += 1;
      else if (s === "attention") attention += 1;
      else todo += 1;
    }
    for (const row of LUGGAGE_ROWS) {
      total += 1;
      const s = trip.luggage?.[person.id]?.[row.key] ?? "todo";
      if (s === "done" || s === "na") done += 1;
      else if (s === "attention") attention += 1;
      else todo += 1;
    }
  }

  if (attention > 0 || (todo > 0 && done === 0)) {
    return {
      tone: attention > 0 ? "red" : "yellow",
      label: `${trip.people.length} travellers — ${done}/${total} checks done`,
    };
  }
  if (todo > 0) {
    return {
      tone: "yellow",
      label: `${done}/${total} packing & docs done`,
    };
  }
  return {
    tone: "green",
    label: `${trip.people.length} travellers — all checks done`,
  };
}

export function combineTone(...tones: SectionTone[]): SectionTone {
  return tones.reduce((a, b) => worst(a, b), "green" as SectionTone);
}
