import type { BookingDetails, BookingStatus } from "./types";

export function parseBookingStatus(raw?: string): BookingStatus {
  const t = (raw ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (
    /\b(confirmed|booked|booking confirmed|reservation confirmed|ticketed)\b/.test(t) &&
    !/\bunpaid|balance due|awaiting payment|deposit only\b/.test(t)
  ) {
    return "confirmed";
  }
  if (/\b(paid in full|fully paid|payment received|payment complete)\b/.test(t)) {
    return "paid";
  }
  if (/\b(unpaid|balance due|awaiting payment|deposit paid|pay at hotel|amount due)\b/.test(t)) {
    return "unpaid";
  }
  if (/\bpaid\b/.test(t)) return "paid";
  if (/\bconfirm/.test(t)) return "confirmed";
  return "unknown";
}

export function isAutoConfirmed(status: BookingStatus): boolean {
  return status === "paid" || status === "confirmed";
}

/** Split "20/09/2026 10:05" or "20 Sept 2026, 10:05" into date + time. */
export function splitDateTime(value?: string): { date?: string; time?: string } {
  if (!value?.trim()) return {};
  const s = value.trim().replace(/\s+at\s+/i, " ");
  const m = s.match(
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})(?:[,\s]+(\d{1,2}:\d{2}))?$/i,
  );
  if (m) return { date: m[1], time: m[2] };
  if (/^\d{1,2}:\d{2}$/.test(s)) return { time: s };
  return { date: s };
}

export function joinDateTime(date?: string, time?: string): string | undefined {
  const d = date?.trim();
  const t = time?.trim();
  if (d && t) return `${d} ${t}`;
  return d || t || undefined;
}

export function peopleList(people?: string): string[] {
  if (!people?.trim()) return [];
  return people
    .split(/[,;\n]+/)
    .map((p) =>
      p
        .trim()
        // Strip titles often present on hotel/flight manifests
        .replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "")
        .trim(),
    )
    .filter(Boolean);
}

export function buildUsefulInfo(parts: Array<string | undefined | false>): string | undefined {
  const lines = parts.filter((p): p is string => Boolean(p && String(p).trim())).map((p) => p.trim());
  return lines.length ? lines.join("\n") : undefined;
}

export function emptyDetails(partial?: Partial<BookingDetails>): BookingDetails {
  return {
    status: "unknown",
    ...partial,
  };
}
