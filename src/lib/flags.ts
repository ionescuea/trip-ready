import type { Flag, Trip } from "./types";
import { peopleList } from "./bookingDetails";
import { joinDateTime } from "./bookingDetails";
import { personCoveredByBookingNames } from "./names";

function namesFromBooking(trip: Trip, type: "flight" | "hotel"): string[] {
  const booking = trip.bookings.find((b) => b.type === type);
  if (!booking) return [];
  return peopleList(booking.extracted.people);
}

export function computeFlags(trip: Trip): Flag[] {
  const flags: Flag[] = [];
  const flight = trip.bookings.find((b) => b.type === "flight");
  const hotel = trip.bookings.find((b) => b.type === "hotel");
  const parking = trip.bookings.find((b) => b.type === "parking");

  const flightNames = namesFromBooking(trip, "flight");
  const hotelNames = namesFromBooking(trip, "hotel");

  if (flightNames.length && trip.people.length) {
    const missing = trip.people
      .filter((p) => p.name.trim() && !personCoveredByBookingNames(p.name, flightNames))
      .map((p) => p.name);
    if (missing.length) {
      flags.push({
        id: "name-flight",
        severity: "red",
        title: "Name mismatch on flight",
        detail: `Not clearly on the flight booking: ${missing.join(", ")}. Hyphenated names still match a first name (e.g. Elena ↔ Elena-Alexandra).`,
      });
    }
  }

  if (hotelNames.length && trip.people.length) {
    const missing = trip.people
      .filter((p) => p.name.trim() && !personCoveredByBookingNames(p.name, hotelNames))
      .map((p) => p.name);
    if (missing.length) {
      flags.push({
        id: "name-hotel",
        severity: "yellow",
        title: "Name mismatch on hotel",
        detail: `Not clearly on the hotel guest list: ${missing.join(", ")}.`,
      });
    }
  }

  if (flight && parking) {
    const entry = joinDateTime(parking.extracted.startDate, parking.extracted.startTime);
    if (!entry) {
      flags.push({
        id: "parking-time",
        severity: "yellow",
        title: "Parking entry time missing",
        detail: "Add the parking entry window so leave-by timing can be trusted.",
      });
    }
  }

  const drive = trip.driveMinutes ?? 0;
  const holdHint =
    flight &&
    /hold|checked|\d+\s*x/i.test(`${flight.extracted.holdBags ?? ""} ${flight.extracted.usefulInfo ?? ""}`);
  if (drive > 0 && drive + (trip.parkingMinutes ?? 20) < 45 && holdHint) {
    flags.push({
      id: "leave-by-tight",
      severity: "yellow",
      title: "Leave-by may be tight",
      detail:
        "Checked bags + short ground buffer. Recheck the leave-home time with a bigger contingency.",
    });
  }

  for (const booking of trip.bookings) {
    if (booking.extracted.status === "unpaid") {
      flags.push({
        id: `paid-${booking.id}`,
        severity: "red",
        title: `${booking.type} unpaid / balance due`,
        detail: booking.extracted.remainingBalance
          ? `Possible remaining balance: ${booking.extracted.remainingBalance}`
          : "Mark as paid or confirmed when settled.",
      });
    } else if (booking.extracted.status === "unknown" && !booking.confirmed) {
      flags.push({
        id: `confirm-${booking.id}`,
        severity: "yellow",
        title: `Confirm ${booking.type} status`,
        detail: `Extracted from “${booking.sourceName}” — set status to Paid or Confirmed when you have checked it.`,
      });
    }
  }

  if (trip.startDate) {
    const start = new Date(trip.startDate);
    if (!Number.isNaN(start.getTime()) && start.getTime() - Date.now() > 1000 * 60 * 60 * 24 * 60) {
      flags.push({
        id: "long-lead",
        severity: "yellow",
        title: "Long-lead booking — re-verify",
        detail:
          "Trip is still more than 60 days out (or was booked long ago). Re-check schedule changes and remaining balances on the booking sites once.",
      });
    }
  }

  for (const person of trip.people) {
    const cells = trip.checklist[person.id] ?? {};
    if (cells.passport_packed !== "done" || cells.passport_rules !== "done") {
      flags.push({
        id: `docs-${person.id}`,
        severity: "red",
        title: `Documents incomplete — ${person.name}`,
        detail: "Passport packed and passport rules still need a green tick.",
      });
    }
    if (cells.visa === "todo" || cells.visa === "attention") {
      flags.push({
        id: `visa-${person.id}`,
        severity: "yellow",
        title: `Visa / ETIAS open — ${person.name}`,
        detail: "Confirm whether visa-free / ETIAS applies for this passport closer to departure.",
      });
    }
  }

  if (!flight) {
    flags.push({
      id: "no-flight",
      severity: "red",
      title: "No flight confirmation yet",
      detail: "Drop the flight email so times, bags, and passenger names can be checked.",
    });
  }
  if (!parking) {
    flags.push({
      id: "no-parking",
      severity: "yellow",
      title: "No parking booking yet",
      detail: "Drop the parking confirmation if you are driving to the airport.",
    });
  }
  if (!trip.fromTown?.trim() && !trip.homePostcode?.trim()) {
    flags.push({
      id: "no-from-town",
      severity: "yellow",
      title: "Starting town not set",
      detail:
        "Add the driver’s start postcode (or a town) so the drive can be estimated.",
    });
  }
  if (!trip.driverPersonId && trip.people.length > 0) {
    flags.push({
      id: "no-driver",
      severity: "red",
      title: "Driver not set",
      detail:
        "Choose who drives on Leave home by — the route starts at their postcode.",
    });
  }
  if (parking && !parking.extracted.routeStart) {
    flags.push({
      id: "parking-route-start",
      severity: "red",
      title: "Confirm trip starting point",
      detail:
        "On the parking booking, tick “Trip starting point” so the driver is set as who leaves first.",
    });
  }
  if (trip.people.length > 0 && !trip.homePostcode?.trim()) {
    flags.push({
      id: "no-driver-start",
      severity: "red",
      title: "Driver start postcode missing",
      detail:
        "Add the address or postcode where the driver leaves — pick-ups are routed from there.",
    });
  }
  if (!trip.toTown?.trim() && !parking && !flight?.extracted.departureAirport) {
    flags.push({
      id: "no-to-town",
      severity: "yellow",
      title: "Destination town not set",
      detail:
        "Add any town, city, or airport area you are driving to for the leave-by estimate.",
    });
  }

  const seen = new Set<string>();
  return flags.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}
