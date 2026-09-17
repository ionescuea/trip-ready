import type { BookingDetails } from "./types";
import { emptyDetails } from "./bookingDetails";

/** Infer where the car park sits relative to the terminal, and shuttle needs. */
export function enrichParkingFields(rawText: string, fields: BookingDetails): BookingDetails {
  const t = rawText.toLowerCase();
  const name = (fields.name ?? "").toLowerCase();
  const combined = `${t} ${name}`;

  let locationRelative = fields.locationRelative;
  if (!locationRelative) {
    if (/meet\s*(and|&)\s*greet|valet/i.test(combined)) {
      locationRelative = "Meet & greet (car collected near terminal)";
    } else if (/off[- ]?airport|park\s*&\s*ride|off site|off-site/i.test(combined)) {
      locationRelative = "Off-airport — shuttle to terminal required";
    } else if (/long\s*stay|mid\s*stay|short\s*stay|on[- ]?airport|multi[- ]?storey/i.test(combined)) {
      locationRelative = "On-airport / airport campus — transfer to terminal";
    } else if (/shuttle/i.test(combined)) {
      locationRelative = "Parking with shuttle to terminal";
    }
  }

  let terminal = fields.terminal;
  if (!terminal) {
    const term =
      rawText.match(/(?:terminal|towards)\s*[:\-]?\s*(north|south|east|west|[0-9]+|[A-Z])\b/i)?.[1] ||
      rawText.match(/\b(north|south)\s+terminal\b/i)?.[0];
    if (term) terminal = /terminal/i.test(term) ? term : `Terminal ${term}`;
  }

  let shuttleIncluded = fields.shuttleIncluded;
  let shuttleDetails = fields.shuttleDetails;
  const hasShuttle = /shuttle|courtesy bus|transfer bus|park\s*&\s*ride/i.test(combined);
  const noShuttle = /no shuttle|walk to terminal|within walking distance/i.test(combined);

  if (!shuttleIncluded) {
    if (hasShuttle || /off[- ]?airport|long\s*stay/i.test(combined)) {
      shuttleIncluded = "yes";
    } else if (noShuttle || /meet\s*(and|&)\s*greet|short\s*stay|multi[- ]?storey/i.test(combined)) {
      shuttleIncluded = /meet/i.test(combined) ? "no — meet & greet at terminal" : "no — walk to terminal";
    }
  }

  if (!shuttleDetails && hasShuttle) {
    const every =
      rawText.match(/shuttle[^.\n]{0,40}(?:every|runs every)\s*([0-9]+\s*(?:-|to)\s*[0-9]+\s*)?minutes?/i)?.[0] ||
      rawText.match(/every\s+[0-9]+\s*minutes?/i)?.[0] ||
      rawText.match(/shuttle[^\n.]{5,80}/i)?.[0];
    shuttleDetails = every?.trim() || "Shuttle to terminal included";
  }

  let transferMinutes = fields.transferMinutes;
  if (!transferMinutes) {
    transferMinutes = String(
      estimateTransferMinutes({
        ...fields,
        locationRelative,
        shuttleIncluded,
        shuttleDetails,
        terminal,
      }),
    );
  }

  return emptyDetails({
    ...fields,
    locationRelative,
    terminal,
    shuttleIncluded,
    shuttleDetails,
    transferMinutes,
  });
}

export function estimateTransferMinutes(fields: BookingDetails): number {
  const blob = `${fields.locationRelative ?? ""} ${fields.shuttleIncluded ?? ""} ${fields.shuttleDetails ?? ""} ${fields.name ?? ""} ${fields.usefulInfo ?? ""}`.toLowerCase();

  // Oakwood / close parks: shuttle is only a few minutes
  if (/oakwood/.test(blob) || /5\s*min/.test(blob)) return 5;
  if (/meet\s*&?\s*greet|valet/.test(blob)) return 15;
  if (/short\s*stay|multi[- ]?storey|walk/.test(blob) && !/shuttle/.test(blob)) return 15;
  if (/off[- ]?airport|park\s*&\s*ride/.test(blob)) return 35;
  if (/long\s*stay|mid\s*stay|shuttle/.test(blob)) return 30;
  return 25;
}

export function parkingTransferSummary(fields: BookingDetails): string {
  const bits = [
    fields.name,
    fields.locationRelative,
    fields.terminal ? `Serves ${fields.terminal}` : null,
    fields.shuttleDetails ||
      (fields.shuttleIncluded?.toLowerCase().startsWith("yes")
        ? "Shuttle to airport/terminal"
        : fields.shuttleIncluded),
  ].filter(Boolean);
  return bits.join(" · ");
}

export function parseTransferMinutes(fields?: BookingDetails, fallback = 25): number {
  if (!fields) return fallback;
  const n = Number(fields.transferMinutes);
  if (Number.isFinite(n) && n > 0) return n;
  return estimateTransferMinutes(fields);
}
