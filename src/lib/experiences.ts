import { parseFlexibleDate } from "@/lib/dates";
import type { Booking, Trip } from "@/lib/types";

export function experienceBookings(trip: Trip): Booking[] {
  return trip.bookings.filter((b) => b.type === "experience");
}

/** Chronological day trips / experiences for hub + Bookings. */
export function sortedExperiences(trip: Trip): Booking[] {
  return [...experienceBookings(trip)].sort((a, b) => {
    const ta =
      parseFlexibleDate(
        [a.extracted.startDate, a.extracted.startTime].filter(Boolean).join(" "),
      )?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb =
      parseFlexibleDate(
        [b.extracted.startDate, b.extracted.startTime].filter(Boolean).join(" "),
      )?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

export function experienceSectionStatus(trip: Trip): {
  tone: "green" | "yellow" | "red";
  label: string;
} {
  const list = sortedExperiences(trip);
  if (list.length === 0) {
    return { tone: "yellow", label: "Add day trips & tours" };
  }
  const next = list.find((b) => {
    const d = parseFlexibleDate(
      [b.extracted.startDate, b.extracted.startTime].filter(Boolean).join(" "),
    );
    return d && d.getTime() >= Date.now() - 12 * 60 * 60 * 1000;
  });
  if (next?.extracted.name) {
    const when = [next.extracted.startDate, next.extracted.startTime]
      .filter(Boolean)
      .join(" · ");
    return {
      tone: "green",
      label: `${list.length} planned · next ${when || next.extracted.name}`,
    };
  }
  return { tone: "green", label: `${list.length} day trip${list.length === 1 ? "" : "s"}` };
}
