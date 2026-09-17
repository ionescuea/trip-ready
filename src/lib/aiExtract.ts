import type { BookingDetails, BookingStatus, BookingType } from "./types";
import { emptyDetails, isAutoConfirmed, parseBookingStatus } from "./bookingDetails";
import { extractArriveEarlyMinutes } from "./arriveEarly";
import type { ExtractResult } from "./extract";

type AiBooking = {
  type?: string;
  name?: string;
  number?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  people?: string | string[];
  usefulInfo?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  airport?: string;
  cabinBags?: string;
  holdBags?: string;
  locationRelative?: string;
  terminal?: string;
  shuttleIncluded?: string;
  shuttleDetails?: string;
  transferMinutes?: string;
  arriveEarlyMinutes?: string;
  vehicleReg?: string;
  remainingBalance?: string;
};

const TYPES: BookingType[] = ["flight", "hotel", "parking", "experience", "other"];

function asType(value?: string): BookingType {
  const t = (value ?? "other").toLowerCase();
  if (t === "activity" || t === "tour" || t === "excursion" || t === "daytrip") {
    return "experience";
  }
  return (TYPES.includes(t as BookingType) ? t : "other") as BookingType;
}

function asPeople(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value?.trim() || undefined;
}

function asStatus(value?: string): BookingStatus {
  return parseBookingStatus(value);
}

export function normalizeAiBookings(raw: unknown): ExtractResult[] {
  const payload = raw as { bookings?: AiBooking[] } | AiBooking[];
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.bookings)
      ? payload.bookings
      : [];

  return list
    .map((item) => {
      const status = asStatus(item.status);
      const fields: BookingDetails = emptyDetails({
        name: item.name?.trim() || undefined,
        number: item.number?.trim() || undefined,
        startDate: item.startDate?.trim() || undefined,
        endDate: item.endDate?.trim() || undefined,
        startTime: item.startTime?.trim() || undefined,
        endTime: item.endTime?.trim() || undefined,
        status,
        people: asPeople(item.people),
        usefulInfo: item.usefulInfo?.trim() || undefined,
        departureAirport: item.departureAirport?.trim() || undefined,
        arrivalAirport: item.arrivalAirport?.trim() || undefined,
        airport: item.airport?.trim() || undefined,
        cabinBags: item.cabinBags?.trim() || undefined,
        holdBags: item.holdBags?.trim() || undefined,
        locationRelative: item.locationRelative?.trim() || undefined,
        terminal: item.terminal?.trim() || undefined,
        shuttleIncluded: item.shuttleIncluded?.trim() || undefined,
        shuttleDetails: item.shuttleDetails?.trim() || undefined,
        transferMinutes: item.transferMinutes?.trim() || undefined,
        arriveEarlyMinutes: item.arriveEarlyMinutes?.trim() || undefined,
        vehicleReg: item.vehicleReg?.trim() || undefined,
        remainingBalance: item.remainingBalance?.trim() || undefined,
      });

      // Backfill arrive-early from usefulInfo only if AI omitted the dedicated field
      if (!fields.arriveEarlyMinutes && fields.usefulInfo) {
        const mins = extractArriveEarlyMinutes(fields.usefulInfo);
        if (mins != null) fields.arriveEarlyMinutes = String(mins);
      }

      if (!fields.name) {
        fields.name =
          asType(item.type) === "flight"
            ? "Flight"
            : asType(item.type) === "hotel"
              ? "Hotel"
              : asType(item.type) === "parking"
                ? "Parking"
                : asType(item.type) === "experience"
                  ? "Day trip"
                  : "Booking";
      }

      return {
        type: asType(item.type),
        fields,
        confidence: "high" as const,
        notes: ["Extracted with AI — check fields, then confirm."],
        autoConfirmed: isAutoConfirmed(status),
      };
    })
    .filter((r) => r.type !== "other" || Boolean(r.fields.usefulInfo || r.fields.number));
}

export const EXTRACT_SYSTEM_PROMPT = `You extract travel bookings from confirmation emails/PDFs into structured JSON.

Return ONLY valid JSON of the form:
{
  "bookings": [
    {
      "type": "flight" | "hotel" | "parking" | "experience" | "other",
      "name": string,
      "number": string,
      "startDate": string,
      "endDate": string,
      "startTime": string,
      "endTime": string,
      "status": "unpaid" | "paid" | "confirmed" | "unknown",
      "people": string,
      "usefulInfo": string,
      "departureAirport": string,
      "arrivalAirport": string,
      "airport": string,
      "cabinBags": string,
      "holdBags": string,
      "locationRelative": string,
      "terminal": string,
      "shuttleIncluded": string,
      "shuttleDetails": string,
      "transferMinutes": string,
      "arriveEarlyMinutes": string,
      "vehicleReg": string,
      "remainingBalance": string
    }
  ]
}

Rules:
- If one document contains flights AND hotel (package holiday), return TWO bookings (flight + hotel).
- Parking is a separate booking when present.
- TUI / Musement tours, day trips, cruises, guided walks, food tours → type "experience". Put the meeting point in locationRelative. Put inclusions, dress code, print-voucher notes, and local contact in usefulInfo.
- Prefer DD/MM/YYYY for dates and HH:MM (24h) for times when possible.
- For UK airport parking, "Departure" is parking start and "Return" is parking end.
- CRITICAL: If the booking states how early to arrive at the airport (e.g. "3 hours before departure"), set arriveEarlyMinutes to that value in minutes (e.g. "180"). Also mention it in usefulInfo. Do NOT invent arrive-early if the text is silent.
- For parking, if shuttle/transfer time is stated (e.g. "5 minutes to the terminal"), set transferMinutes.
- status: use "confirmed" if booking/reservation is confirmed; "paid" if fully paid; "unpaid" if balance/deposit due; else "unknown".
- people: comma-separated passenger/guest/driver names without titles if easy. For experiences, ticket counts like "3 x Adult" are fine.
- usefulInfo: short notes (bags, board basis, room, shuttle, transfer, address, extra refs, inclusions).
- Omit unknown fields or use empty string.
- Do not invent bookings that are not in the text.
- Booking-stated times, arrive-early rules, and transfer times are the most important fields — extract them carefully.`;
