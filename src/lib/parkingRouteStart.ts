import { peopleList } from "@/lib/bookingDetails";
import { findOwnerPerson } from "@/lib/cloudMeta";
import { withDriver } from "@/lib/driver";
import { findBestPersonMatch } from "@/lib/names";
import type { Trip } from "@/lib/types";

/** Mark parking booking as trip start and set driver from “People on booking”. */
export function withParkingAsRouteStart(
  trip: Trip,
  bookingId: string,
  checked: boolean,
): Trip {
  const booking = trip.bookings.find((b) => b.id === bookingId);
  if (!booking || booking.type !== "parking") return trip;

  const bookings = trip.bookings.map((b) => {
    if (b.type !== "parking") return b;
    if (b.id !== bookingId) {
      return {
        ...b,
        extracted: { ...b.extracted, routeStart: false },
      };
    }
    return {
      ...b,
      extracted: { ...b.extracted, routeStart: checked },
    };
  });

  let next: Trip = { ...trip, bookings, updatedAt: new Date().toISOString() };
  if (!checked) return next;

  const names = peopleList(booking.extracted.people);
  let person =
    names.map((n) => findBestPersonMatch(n, next.people)).find(Boolean) ??
    undefined;
  if (!person) {
    person = findOwnerPerson(next.people) ?? next.people[0];
  }
  if (person) next = withDriver(next, person.id);
  return next;
}

export function parkingRouteStartSet(trip: Trip): boolean {
  return trip.bookings.some(
    (b) => b.type === "parking" && b.extracted.routeStart === true,
  );
}
