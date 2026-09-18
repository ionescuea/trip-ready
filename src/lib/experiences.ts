import { parseFlexibleDate } from "@/lib/dates";
import type { Booking, Trip } from "@/lib/types";

export function experienceBookings(trip: Trip): Booking[] {
  return trip.bookings.filter((b) => b.type === "experience");
}

/** Chronological day trips / experiences. */
export function sortedExperiences(trip: Trip): Booking[] {
  return [...experienceBookings(trip)].sort((a, b) => {
    const ta = experienceStartMs(a) ?? Number.MAX_SAFE_INTEGER;
    const tb = experienceStartMs(b) ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

export function experienceStartMs(booking: Booking): number | null {
  const d = parseFlexibleDate(
    [booking.extracted.startDate, booking.extracted.startTime]
      .filter(Boolean)
      .join(" "),
  );
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
}

/** Past once the calendar day after the experience has begun (local). */
export function isExperiencePast(booking: Booking, now = Date.now()): boolean {
  const start = experienceStartMs(booking);
  if (start == null) return false;
  const endOfExperienceDay = new Date(start);
  endOfExperienceDay.setHours(23, 59, 59, 999);
  return now > endOfExperienceDay.getTime();
}

export function experienceSectionStatus(trip: Trip): {
  tone: "green" | "yellow" | "red";
  label: string;
} {
  const list = sortedExperiences(trip);
  if (list.length === 0) {
    return { tone: "yellow", label: "Add day trips & tours" };
  }
  const upcoming = list.filter((b) => !isExperiencePast(b));
  const next = upcoming[0];
  if (next?.extracted.name) {
    const when = [next.extracted.startDate, next.extracted.startTime]
      .filter(Boolean)
      .join(" · ");
    return {
      tone: "green",
      label:
        upcoming.length === list.length
          ? `${list.length} planned · next ${when || next.extracted.name}`
          : `${upcoming.length} left · next ${when || next.extracted.name}`,
    };
  }
  return {
    tone: "green",
    label: `${list.length} day trip${list.length === 1 ? "" : "s"} · all done`,
  };
}
