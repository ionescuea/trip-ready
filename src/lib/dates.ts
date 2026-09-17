const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_ALT = Object.keys(MONTHS).join("|");

/** e.g. 20 Sept, 20 September 2026, 20/09/2026, 20-09-26 */
const DATE_TOKEN = String.raw`(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH_ALT})[a-z]*\.?(?:\s+\d{4})?)`;
/** “, 02:30” or “at 02:30” */
const TIME_SUFFIX = String.raw`(?:(?:[,\s]+|\s+at\s+)\d{1,2}:\d{2})?`;
const DATE_TIME_TOKEN = String.raw`${DATE_TOKEN}${TIME_SUFFIX}`;

export function formatDateDMY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateTimeDMY(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateDMY(d)} ${hh}:${min}`;
}

export function parseFlexibleDate(
  raw: string,
  opts?: { defaultYear?: number; defaultHour?: number; defaultMinute?: number },
): Date | null {
  const s = raw.trim().replace(/\s+/g, " ").replace(/\s+at\s+/i, " ");
  if (!s) return null;

  const withTime = s.match(
    new RegExp(
      String.raw`^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2}))?$`,
      "i",
    ),
  );
  if (withTime) {
    const day = Number(withTime[1]);
    const month = Number(withTime[2]) - 1;
    let year = Number(withTime[3]);
    if (year < 100) year += 2000;
    const hour = Number(withTime[4] ?? opts?.defaultHour ?? 0);
    const minute = Number(withTime[5] ?? opts?.defaultMinute ?? 0);
    const d = new Date(year, month, day, hour, minute);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const named = s.match(
    new RegExp(
      String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_ALT})[a-z]*\.?(?:\s+(\d{4}))?(?:[,\s]+(\d{1,2}):(\d{2}))?$`,
      "i",
    ),
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    const year = named[3] ? Number(named[3]) : opts?.defaultYear ?? guessYear(month, day);
    const hour = Number(named[4] ?? opts?.defaultHour ?? 0);
    const minute = Number(named[5] ?? opts?.defaultMinute ?? 0);
    if (month === undefined) return null;
    const d = new Date(year, month, day, hour, minute);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function guessYear(month: number, day: number): number {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  // If date already passed more than ~2 months ago, assume next year
  if (candidate.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 60) {
    year += 1;
  }
  return year;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export type StayDates = {
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  note?: string;
};

/** Pull hotel stay dates, including “20 Sept for 7 nights”. */
export function extractStayDates(text: string): StayDates {
  const flat = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  const labeledIn = flat.match(
    new RegExp(
      String.raw`(?:check[\s-]?in|arrival|arrive|from)\s*(?:date|on)?\s*[:\-]?\s*(${DATE_TOKEN})`,
      "i",
    ),
  )?.[1];
  const labeledOut = flat.match(
    new RegExp(
      String.raw`(?:check[\s-]?out|departure|depart|until|to)\s*(?:date|on)?\s*[:\-]?\s*(${DATE_TOKEN})`,
      "i",
    ),
  )?.[1];

  const range = flat.match(
    new RegExp(String.raw`(${DATE_TOKEN})\s*(?:–|-|—|to|until)\s*(${DATE_TOKEN})`, "i"),
  );

  // “20 Sept for 7 nights” / “7 nights from 20 September 2026”
  const nightsAfter = flat.match(
    new RegExp(
      String.raw`(${DATE_TOKEN})\s*(?:,?\s*)?(?:for\s+)?(\d{1,2})\s*nights?`,
      "i",
    ),
  );
  const nightsBefore = flat.match(
    new RegExp(
      String.raw`(\d{1,2})\s*nights?\s*(?:from|starting|commencing|on)?\s*(${DATE_TOKEN})`,
      "i",
    ),
  );

  let checkInRaw = labeledIn || range?.[1] || nightsAfter?.[1] || nightsBefore?.[2];
  let checkOutRaw = labeledOut || range?.[2];
  let nights =
    (nightsAfter ? Number(nightsAfter[2]) : undefined) ??
    (nightsBefore ? Number(nightsBefore[1]) : undefined);

  if (!nights) {
    const n = flat.match(/\b(\d{1,2})\s*nights?\b/i)?.[1];
    if (n) nights = Number(n);
  }

  const checkInDate = checkInRaw ? parseFlexibleDate(checkInRaw, { defaultHour: 15 }) : null;
  let checkOutDate = checkOutRaw ? parseFlexibleDate(checkOutRaw, { defaultHour: 11 }) : null;

  if (checkInDate && !checkOutDate && nights && nights > 0) {
    checkOutDate = addDays(checkInDate, nights);
    return {
      checkIn: formatDateDMY(checkInDate),
      checkOut: formatDateDMY(checkOutDate),
      nights,
      note: `Check-out calculated as check-in + ${nights} nights.`,
    };
  }

  if (checkInDate && checkOutDate && !nights) {
    const ms = checkOutDate.getTime() - checkInDate.getTime();
    nights = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
  }

  return {
    checkIn: checkInDate ? formatDateDMY(checkInDate) : checkInRaw?.trim(),
    checkOut: checkOutDate ? formatDateDMY(checkOutDate) : checkOutRaw?.trim(),
    nights,
  };
}

export type ParkingDates = {
  entryAt?: string;
  exitAt?: string;
  note?: string;
};

/** Pull parking entry/exit. UK car parks often use Departure = drop-off, Return = collect. */
export function extractParkingDates(text: string): ParkingDates {
  const flat = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  // Prefer explicit parking wording first
  const departureRaw = flat.match(
    new RegExp(
      String.raw`(?:^|\n|\b)departure\s*[:\-]?\s*(${DATE_TIME_TOKEN})`,
      "i",
    ),
  )?.[1];
  const returnRaw = flat.match(
    new RegExp(String.raw`(?:^|\n|\b)return\s*[:\-]?\s*(${DATE_TIME_TOKEN})`, "i"),
  )?.[1];

  const entryRaw =
    departureRaw ||
    flat.match(
      new RegExp(
        String.raw`(?:entry|enter|arrive|arrival|drop[\s-]?off|start(?:ing)?)\s*(?:date|time|on)?\s*[:\-]?\s*(${DATE_TIME_TOKEN})`,
        "i",
      ),
    )?.[1];

  const exitRaw =
    returnRaw ||
    flat.match(
      new RegExp(
        String.raw`(?:exit|leave|collect|collection|end(?:ing)?|until)\s*(?:date|time|on)?\s*[:\-]?\s*(${DATE_TIME_TOKEN})`,
        "i",
      ),
    )?.[1];

  const range = flat.match(
    new RegExp(
      String.raw`(${DATE_TIME_TOKEN})\s*(?:–|-|—|to|until)\s*(${DATE_TIME_TOKEN})`,
      "i",
    ),
  );

  const nightsAfter = flat.match(
    new RegExp(
      String.raw`(${DATE_TOKEN})\s*(?:,?\s*)?(?:for\s+)?(\d{1,2})\s*nights?`,
      "i",
    ),
  );

  const entryParsed = parseFlexibleDate(entryRaw || range?.[1] || nightsAfter?.[1] || "", {
    defaultHour: 5,
    defaultMinute: 0,
  });
  let exitParsed = parseFlexibleDate(exitRaw || range?.[2] || "", {
    defaultHour: 18,
    defaultMinute: 0,
  });

  if (entryParsed && !exitParsed && nightsAfter?.[2]) {
    const nights = Number(nightsAfter[2]);
    exitParsed = addDays(entryParsed, nights);
    exitParsed.setHours(18, 0, 0, 0);
    return {
      entryAt: formatDateTimeDMY(entryParsed),
      exitAt: formatDateTimeDMY(exitParsed),
      note: `Parking exit calculated as entry + ${nights} nights.`,
    };
  }

  return {
    entryAt: entryParsed
      ? formatDateTimeDMY(entryParsed)
      : (entryRaw || range?.[1])?.trim(),
    exitAt: exitParsed
      ? formatDateTimeDMY(exitParsed)
      : (exitRaw || range?.[2])?.trim(),
    note:
      departureRaw && returnRaw
        ? "Used Departure/Return times from the parking confirmation."
        : undefined,
  };
}
