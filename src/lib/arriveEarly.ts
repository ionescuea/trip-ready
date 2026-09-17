/**
 * Booking “arrive early” guidance — the core signal for airport deadline.
 * Only return a value when the confirmation text actually states it.
 */

export function extractArriveEarlyMinutes(text: string): number | null {
  if (!text.trim()) return null;
  const t = text.replace(/\s+/g, " ");

  const patterns: RegExp[] = [
    // "arrive at the airport at least 3 hours before departure"
    /arrive(?:\s+early)?\s*(?:at\s+(?:the\s+)?airport)?\s*[:\-]?\s*(?:at\s+least\s+)?(\d+(?:\.\d+)?)\s*hours?\s+before/i,
    /be\s+at\s+(?:the\s+)?airport\s+(?:at\s+least\s+)?(\d+(?:\.\d+)?)\s*hours?\s+before/i,
    /(?:check[\s-]?in)\s+(?:at\s+(?:the\s+)?airport\s+)?(?:at\s+least\s+)?(\d+(?:\.\d+)?)\s*hours?\s+before/i,
    /(\d+(?:\.\d+)?)\s*hours?\s+before\s+(?:departure|your\s+flight|take-?off|flying|scheduled\s+departure)/i,
    /(?:recommended|please|we\s+(?:ask|recommend)|passengers\s+(?:should|must))\s+arrive\s+(\d+(?:\.\d+)?)\s*hours?/i,
    /arrive\s+(?:no\s+later\s+than\s+)?(\d+(?:\.\d+)?)\s*hours?\s+prior/i,
    /(?:arrive|be\s+at\s+(?:the\s+)?airport)\s+(?:at\s+least\s+)?(\d+)\s*minutes?\s+before/i,
    // "Arrive early: 3 hours" (structured note — only if written from real extract)
    /arrive\s+early\s*[:\-]\s*(\d+(?:\.\d+)?)\s*hours?/i,
    // easyJet-style "3 hours before your flight"
    /(\d+(?:\.\d+)?)\s*hours?\s+before\s+your\s+(?:scheduled\s+)?flight/i,
  ];

  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (!m?.[1]) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (/minutes?/i.test(m[0])) return Math.round(n);
    if (n <= 12) return Math.round(n * 60);
    return Math.round(n);
  }

  return null;
}

/**
 * Default only when the booking is silent.
 * International / Schengen holidays → 3h (e.g. 06:10 → airport by 03:10).
 */
export function defaultArriveEarlyMinutes(opts: {
  arrivalAirport?: string;
  destination?: string;
  hasHoldBags?: boolean;
}): number {
  const intl =
    /ATH|Athens|Greece|Schengen|international|abroad|BRS\s*→|LGW\s*→|MAN\s*→/i.test(
      `${opts.arrivalAirport ?? ""} ${opts.destination ?? ""}`,
    ) || false;
  if (intl) return 180;
  return opts.hasHoldBags ? 150 : 120;
}

export type ArriveEarlyResolution = {
  minutes: number;
  source: "booking" | "default";
  detail: string;
};

/**
 * Resolve arrive-early from real booking text first, then typed field, then default.
 * Never treat app-invented defaults as “from booking”.
 */
export function resolveArriveEarlyMinutes(opts: {
  rawText?: string;
  /** Explicit minutes stored on the booking when extract found them */
  fieldMinutes?: number | string | null;
  arrivalAirport?: string;
  destination?: string;
  hasHoldBags?: boolean;
}): ArriveEarlyResolution {
  const fromRaw = opts.rawText ? extractArriveEarlyMinutes(opts.rawText) : null;
  if (fromRaw != null) {
    return {
      minutes: fromRaw,
      source: "booking",
      detail: `From booking confirmation: be at the airport ${formatHours(fromRaw)} before departure.`,
    };
  }

  const field = parseMinutesField(opts.fieldMinutes);
  if (field != null) {
    return {
      minutes: field,
      source: "booking",
      detail: `From booking field: be at the airport ${formatHours(field)} before departure.`,
    };
  }

  const fallback = defaultArriveEarlyMinutes({
    arrivalAirport: opts.arrivalAirport,
    destination: opts.destination,
    hasHoldBags: opts.hasHoldBags,
  });
  return {
    minutes: fallback,
    source: "default",
    detail: `Booking has no arrive-early line — using ${formatHours(fallback)} default for this route.`,
  };
}

function parseMinutesField(value?: number | string | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function formatHours(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}
