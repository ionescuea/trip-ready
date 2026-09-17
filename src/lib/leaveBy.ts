import type { BookingDetails, Trip } from "./types";
import { getTripAirportLabel } from "./airports";
import { resolveArriveEarlyMinutes } from "./arriveEarly";
import { joinDateTime } from "./bookingDetails";
import { parkingTransferSummary, parseTransferMinutes } from "./parking";
import { formatDuration, roundUpMinutes } from "./duration";

/**
 * Leave-by = booking specifics + map distance + user inputs.
 *
 * Priority:
 *  1. Flight date/time + arrive-early from the booking (never invent as “from booking”)
 *  2. Parking safety window (user / default 40 min) — transfer sits inside it
 *  3. Drive minutes from road distance (maps)
 *  4. Small defaults only when the booking is silent
 */

/** User safety gap between being at the car park and being at the airport. */
export const DEFAULT_PARKING_SAFETY_WINDOW_MINUTES = 40;

export type PickupArrival = {
  id: string;
  label: string;
  personId?: string;
  personName?: string;
  arriveAt: Date;
  dwellMinutes: number;
};

export type LeaveByPlan = {
  flightDepartureLabel: string;
  gateCloseAt: Date | null;
  leaveHomeAt: Date | null;
  /** Arrive at the car park at this time (not earlier, not later). */
  parkingArriveBy: Date | null;
  airportArriveBy: Date | null;
  /** Arrive-at times for pick-ups / stops between home and parking. */
  pickups: PickupArrival[];
  steps: { label: string; minutes: number }[];
  totalMinutesBeforeDeparture: number;
  arriveEarlyMinutes: number;
  arriveEarlySource: "booking" | "default";
  trafficContingencyMinutes: number;
  transferMinutes: number;
  /** Parking → airport safety window (includes short transfer). */
  parkingToAirportWindowMinutes: number;
  nightDrive: boolean;
  notes: string[];
  parkingSummary?: string;
};

function parseLooseDate(value?: string): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const m = value.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2}))?/,
  );
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const hour = Number(m[4] ?? 10);
    const minute = Number(m[5] ?? 0);
    const d = new Date(year, month, day, hour, minute);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function flightArriveEarly(trip: Trip, fields: BookingDetails, hasHold: boolean) {
  const flight = trip.bookings.find((b) => b.type === "flight");
  // Prefer raw booking text — do not parse app-written usefulInfo as a booking fact
  return resolveArriveEarlyMinutes({
    rawText: flight?.rawText,
    fieldMinutes: fields.arriveEarlyMinutes,
    arrivalAirport: fields.arrivalAirport,
    destination: trip.destination || fields.arrivalAirport,
    hasHoldBags: hasHold,
  });
}

export function isNightOrQuietDrive(arriveAt: Date | null): boolean {
  if (!arriveAt) return false;
  const hour = arriveAt.getHours();
  return hour >= 0 && hour < 7;
}

function isNearAirportParking(parking?: BookingDetails): boolean {
  if (!parking) return false;
  const blob = `${parking.name ?? ""} ${parking.locationRelative ?? ""} ${parking.shuttleDetails ?? ""} ${parking.usefulInfo ?? ""}`;
  return /oakwood|5\s*min(?:ute)?s?\s*(?:from|to)|minutes?\s*from\s*(?:the\s*)?airport/i.test(blob);
}

export function resolveTransferMinutes(trip: Trip, parking?: BookingDetails): number {
  if (typeof trip.parkingMinutes === "number" && trip.parkingMinutes >= 0) {
    return roundUpMinutes(trip.parkingMinutes);
  }
  const near = isNearAirportParking(parking);
  if (parking) return roundUpMinutes(parseTransferMinutes(parking, near ? 5 : 25));
  return 0;
}

/**
 * Safety window: parking arrival → airport deadline.
 * Prefer trip override; else 40 min when parking is on the trip (user’s intentional buffer).
 */
export function resolveParkingSafetyWindow(trip: Trip, hasParking: boolean): number {
  if (!hasParking) return 0;
  if (typeof trip.parkingSafetyWindowMinutes === "number" && trip.parkingSafetyWindowMinutes >= 0) {
    return roundUpMinutes(trip.parkingSafetyWindowMinutes);
  }
  return DEFAULT_PARKING_SAFETY_WINDOW_MINUTES;
}

function subtractMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() - roundUpMinutes(minutes) * 60_000);
}

function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + roundUpMinutes(minutes) * 60_000);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function stopHasAddress(trip: Trip, stop: { address?: string; personId?: string }): boolean {
  if (stop.address?.trim()) return true;
  if (!stop.personId) return false;
  return Boolean(trip.people.find((p) => p.id === stop.personId)?.address?.trim());
}

function pickupLabel(
  trip: Trip,
  stop: { id: string; label: string; personId?: string },
): { label: string; personId?: string; personName?: string } {
  const person = stop.personId
    ? trip.people.find((p) => p.id === stop.personId)
    : undefined;
  if (person) {
    return {
      label: `Pick up ${firstName(person.name)}`,
      personId: person.id,
      personName: person.name,
    };
  }
  const trimmed = stop.label.trim() || "Pick-up";
  return { label: trimmed.startsWith("Pick up") ? trimmed : `Stop: ${trimmed}` };
}

export function computeLeaveBy(trip: Trip): LeaveByPlan {
  const flight = trip.bookings.find((b) => b.type === "flight");
  const fields = (flight?.extracted ?? {}) as BookingDetails;
  const departureAt = joinDateTime(fields.startDate, fields.startTime);
  const departure =
    parseLooseDate(departureAt) ??
    (trip.startDate ? new Date(`${trip.startDate}T10:00:00`) : null);

  const hasHold = Boolean(
    fields.holdBags && !/none|0\s*x|no hold|not included/i.test(fields.holdBags),
  );

  const fromTown = trip.fromTown?.trim();
  const parkingBooking = trip.bookings.find((b) => b.type === "parking");
  const parking = parkingBooking?.extracted;
  const nearParking = isNearAirportParking(parking);

  const airport =
    getTripAirportLabel(
      trip.toTown || trip.driveAirport,
      fields.departureAirport,
      parking?.airport,
    ) || "airport";

  const carParkLabel = parking?.name?.trim() || "airport parking";
  const toPlace =
    trip.toTown?.trim() ||
    (parking
      ? `${carParkLabel}${parking.airport ? ` (${parking.airport})` : ` near ${airport}`}`
      : airport);

  const driveLabel = fromTown
    ? `Drive from ${fromTown} to ${toPlace}`
    : `Drive to ${toPlace}`;

  const driveLegsRaw = (trip.driveLegs ?? []).filter((l) => roundUpMinutes(l.minutes) > 0);
  const mappedDriveMinutes = driveLegsRaw.reduce(
    (sum, l) => sum + roundUpMinutes(l.minutes),
    0,
  );

  const transferMins = resolveTransferMinutes(trip, parking);

  const {
    minutes: arriveEarlyRaw,
    source: arriveEarlySource,
    detail: arriveEarlyDetail,
  } = flightArriveEarly(trip, fields, hasHold);
  const arriveEarlyMinutes = roundUpMinutes(arriveEarlyRaw);

  // Prefer mapped legs when present so leave-home matches the pickup strip
  // (avoids a stale total minutes value shifting the first clock time).
  let driveMinutes =
    mappedDriveMinutes > 0
      ? mappedDriveMinutes
      : typeof trip.driveMinutes === "number" && trip.driveMinutes > 0
        ? roundUpMinutes(trip.driveMinutes)
        : 0;

  // Guard: a single bad geocode used to push leave-home back to early evening
  // (e.g. 7h for Plymouth→Bristol). Cap and ignore those legs for the strip.
  const MAX_SANE_DRIVE_MIN = 210;
  let driveLegs = driveLegsRaw;
  if (driveMinutes > MAX_SANE_DRIVE_MIN) {
    if (trip.driveDistanceKm && trip.driveDistanceKm > 0 && trip.driveDistanceKm < 350) {
      driveMinutes = Math.max(60, Math.ceil((trip.driveDistanceKm / 75) * 60));
    } else {
      driveMinutes = Math.min(driveMinutes, 165);
    }
    driveLegs = [];
  }
  const driveKnown = driveMinutes > 0;

  let airportArriveBy: Date | null = null;
  let parkingArriveBy: Date | null = null;
  let leaveHomeAt: Date | null = null;
  let gateCloseAt: Date | null = null;

  if (departure) {
    airportArriveBy = subtractMinutes(departure, arriveEarlyMinutes);
    gateCloseAt = subtractMinutes(departure, 25);
  }

  const nightDrive = isNightOrQuietDrive(airportArriveBy ?? departure);
  const parkingWindow = resolveParkingSafetyWindow(trip, Boolean(parking));

  // When the user already set a parking→airport safety window, that IS the buffer.
  // Do not also leave earlier for traffic — that would put you at parking before 2:30.
  const trafficContingencyMinutes = parkingWindow > 0 ? 0 : nightDrive ? 5 : 15;

  const allExtraStops = (trip.extraStops ?? []).filter((s) => {
    const driverId = trip.driverPersonId;
    if (driverId && s.personId === driverId) return false;
    return true;
  });
  const routedStopsRaw = allExtraStops.filter((s) => stopHasAddress(trip, s));

  /** Prefer stop order that matches mapped leg destinations (nearest-first from estimate). */
  const routedStops = (() => {
    if (driveLegs.length < 2 || routedStopsRaw.length === 0) return routedStopsRaw;
    const remaining = [...routedStopsRaw];
    const ordered: typeof routedStopsRaw = [];
    for (let i = 0; i < driveLegs.length - 1; i++) {
      const to = driveLegs[i].toLabel.toLowerCase();
      const idx = remaining.findIndex((s) => {
        const info = pickupLabel(trip, s);
        const name = (info.personName || info.label).toLowerCase();
        const first = name.split(/\s+/)[0] || "";
        return (
          (first.length > 2 && to.includes(first)) ||
          to.includes(info.label.toLowerCase()) ||
          (s.address && to.includes(s.address.toLowerCase().slice(0, 8)))
        );
      });
      if (idx >= 0) ordered.push(remaining.splice(idx, 1)[0]);
    }
    return ordered.length > 0 ? [...ordered, ...remaining] : routedStopsRaw;
  })();

  // First pick-up: no dwell — be ready when the car arrives / when you leave.
  const dwellAtRoutedStop = (index: number, stop: { minutes: number }) =>
    index === 0 ? 0 : roundUpMinutes(stop.minutes);

  const extraStopMinutes =
    routedStops.reduce((sum, s, i) => sum + dwellAtRoutedStop(i, s), 0) +
    allExtraStops
      .filter((s) => !stopHasAddress(trip, s))
      .reduce((sum, s) => sum + roundUpMinutes(s.minutes), 0);

  const extraStops = allExtraStops.filter(
    (s) => s && roundUpMinutes(s.minutes) > 0,
  );

  if (airportArriveBy) {
    if (parking && parkingWindow > 0) {
      // Arrive at parking at this time — not earlier, not later
      parkingArriveBy = subtractMinutes(airportArriveBy, parkingWindow);
      const groundToParking =
        (driveKnown ? driveMinutes : 0) + trafficContingencyMinutes + extraStopMinutes;
      leaveHomeAt = subtractMinutes(parkingArriveBy, groundToParking);
    } else {
      parkingArriveBy = airportArriveBy;
      const ground =
        (driveKnown ? driveMinutes : 0) +
        trafficContingencyMinutes +
        transferMins +
        extraStopMinutes;
      leaveHomeAt = subtractMinutes(airportArriveBy, ground);
    }
  }

  const driveAndStopSteps: { label: string; minutes: number }[] = [];
  const pickups: PickupArrival[] = [];

  if (leaveHomeAt && driveLegs.length > 0) {
    let cursor = leaveHomeAt;
    for (let i = 0; i < driveLegs.length; i++) {
      const leg = driveLegs[i];
      cursor = addMinutes(cursor, roundUpMinutes(leg.minutes));
      driveAndStopSteps.push({
        label: `Drive: ${leg.fromLabel} → ${leg.toLabel}`,
        minutes: roundUpMinutes(leg.minutes),
      });
      // Arrive at waypoint (not after the final parking leg)
      if (i < driveLegs.length - 1 && i < routedStops.length) {
        const stop = routedStops[i];
        const dwell = dwellAtRoutedStop(i, stop);
        const info = pickupLabel(trip, stop);
        pickups.push({
          id: stop.id,
          ...info,
          arriveAt: new Date(cursor.getTime()),
          dwellMinutes: dwell,
        });
        if (dwell > 0) {
          driveAndStopSteps.push({
            label: `${info.label} (time at stop)`,
            minutes: dwell,
          });
          cursor = addMinutes(cursor, dwell);
        }
      }
    }
    // Stops without a mappable address still add dwell (no map detour)
    for (const s of allExtraStops) {
      if (stopHasAddress(trip, s)) continue;
      const dwell = roundUpMinutes(s.minutes);
      if (dwell > 0) {
        const info = pickupLabel(trip, s);
        driveAndStopSteps.push({
          label: `${info.label} (time at stop)`,
          minutes: dwell,
        });
      }
    }
  } else if (leaveHomeAt && routedStops.length > 0 && driveKnown) {
    // No multi-leg map yet — split drive evenly home → stop → … → parking
    const legCount = routedStops.length + 1;
    const perLeg = Math.max(1, Math.round(driveMinutes / legCount));
    let cursor = leaveHomeAt;
    for (let i = 0; i < routedStops.length; i++) {
      const stop = routedStops[i];
      cursor = addMinutes(cursor, perLeg);
      const dwell = dwellAtRoutedStop(i, stop);
      const info = pickupLabel(trip, stop);
      pickups.push({
        id: stop.id,
        ...info,
        arriveAt: new Date(cursor.getTime()),
        dwellMinutes: dwell,
      });
      driveAndStopSteps.push({
        label: `Drive to ${info.label}`,
        minutes: perLeg,
      });
      if (dwell > 0) {
        driveAndStopSteps.push({
          label: `${info.label} (time at stop)`,
          minutes: dwell,
        });
        cursor = addMinutes(cursor, dwell);
      }
    }
    const remaining = Math.max(1, driveMinutes - perLeg * routedStops.length);
    driveAndStopSteps.push({ label: driveLabel, minutes: remaining });
  } else {
    if (driveKnown) {
      driveAndStopSteps.push({ label: driveLabel, minutes: driveMinutes });
    }
    for (const s of extraStops) {
      driveAndStopSteps.push({
        label: `${s.label.trim() || "Extra stop"} (time at stop)`,
        minutes: roundUpMinutes(s.minutes),
      });
    }
  }

  const steps = [
    ...driveAndStopSteps,
    trafficContingencyMinutes > 0
      ? {
          label: nightDrive ? "Traffic buffer (overnight)" : "Traffic buffer",
          minutes: trafficContingencyMinutes,
        }
      : null,
    parking && parkingWindow > 0
      ? {
          label: nearParking
            ? `At parking by target (${transferMins} min to terminal inside your ${parkingWindow} min buffer)`
            : `Parking → airport safety buffer`,
          minutes: parkingWindow,
        }
      : parking && transferMins > 0
        ? {
            label: `Park + transfer to terminal`,
            minutes: transferMins,
          }
        : null,
    {
      label:
        arriveEarlySource === "booking"
          ? "Airline: be at airport early"
          : "Be at airport early (recommended)",
      minutes: arriveEarlyMinutes,
    },
  ].filter((s): s is { label: string; minutes: number } => Boolean(s && s.minutes > 0));

  const totalMinutesBeforeDeparture =
    (driveKnown ? driveMinutes : 0) +
    trafficContingencyMinutes +
    extraStopMinutes +
    (parking ? parkingWindow || transferMins : 0) +
    arriveEarlyMinutes;

  const notes: string[] = [];
  const parkingSummary = parking ? parkingTransferSummary(parking) : undefined;

  notes.push(
    "Mix of booking times, map distance, and your inputs — booking specifics win when present.",
  );
  notes.push(arriveEarlyDetail);
  if (parking && parkingWindow > 0) {
    notes.push(
      `Get to parking at ${formatWhen(parkingArriveBy)} — not earlier, not later. Then ${parkingWindow} min until airport by ${formatWhen(airportArriveBy)} (covers ~${transferMins} min transfer + your safety margin).`,
    );
  }
  if (parkingWindow > 0 && trafficContingencyMinutes === 0) {
    notes.push(
      "No extra road contingency on leave-home — that would arrive at parking too early; safety is already in the parking buffer.",
    );
  }
  if (extraStopMinutes > 0) {
    notes.push(
      `Stop dwell time adds ${formatDuration(extraStopMinutes)} (petrol fill-up, waiting). Road detours are in the mapped drive.`,
    );
  }
  const unmappedStops = allExtraStops.filter((s) => {
    if (s.address?.trim()) return false;
    if (!s.personId) return true;
    return !trip.people.find((p) => p.id === s.personId)?.address?.trim();
  });
  if (unmappedStops.length > 0) {
    notes.push(
      `${unmappedStops.length} stop${unmappedStops.length === 1 ? "" : "s"} missing an address — travel time to ${unmappedStops.length === 1 ? "it" : "them"} is not in the drive; only time at the stop is.`,
    );
  }
  if (driveLegs.length > 1) {
    notes.push(
      `Route has ${driveLegs.length} mapped legs (home → stops → parking). Parking/airport clock times stay fixed.`,
    );
  } else if (allExtraStops.some((s) => s.address?.trim() || s.personId) && driveLegs.length <= 1) {
    notes.push(
      "Pick-up / stop addresses are set, but the map still shows a single leg — tap Estimate drive on map to include travel between them.",
    );
  }
  if (!driveKnown) {
    notes.push("Drive time not set — enter towns and tap Estimate drive.");
  }
  if (parkingSummary && !nearParking) notes.push(`Parking: ${parkingSummary}`);
  if (!fromTown) notes.push("Add the town you are travelling from.");
  if (trip.driveDistanceKm && driveKnown) {
    notes.push(`Map route ~${trip.driveDistanceKm} km → ${formatDuration(driveMinutes)} drive.`);
  }
  if (!flight) notes.push("Add a flight confirmation for departure date/time.");
  if (!fields.startDate) notes.push("Add departure date/time on the flight card.");

  return {
    flightDepartureLabel: departureAt || trip.startDate || "Not set",
    gateCloseAt,
    leaveHomeAt,
    parkingArriveBy,
    airportArriveBy,
    pickups,
    steps,
    totalMinutesBeforeDeparture,
    arriveEarlyMinutes,
    arriveEarlySource,
    trafficContingencyMinutes,
    transferMinutes: transferMins,
    parkingToAirportWindowMinutes: parkingWindow,
    nightDrive,
    notes,
    parkingSummary,
  };
}

export function formatWhen(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Split date / clock so the time can lead visually. */
export function formatWhenParts(d: Date | null): { date: string; time: string } | null {
  if (!d) return null;
  return {
    date: d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

/** Compact day label when a timeline step crosses midnight vs the anchor. */
export function formatFlowDayHint(d: Date, anchor: Date | null): string | null {
  if (!anchor) return null;
  if (d.toDateString() === anchor.toDateString()) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}
