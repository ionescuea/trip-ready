/** Shown in every address field — generic UK example (not a real personal address). */
export const ADDRESS_PLACEHOLDER = "12 High Street, Bristol BS1 4DJ";

export const ADDRESS_FORMAT_HINT =
  "Format: number + street, town, postcode — e.g. 12 High Street, Bristol BS1 4DJ. Don’t add UK.";

/** Insert missing postcode space and tidy whitespace (e.g. PL21QG → PL2 1QG). */
export function softNormalizeUkAddress(value: string): string {
  let v = value.replace(/\s+/g, " ").trim();
  if (!v) return "";

  // Split outward like “P L2 1QG” → “PL2 1QG”
  v = v.replace(/\b([A-Z])\s+([A-Z]\d[A-Z\d]?)\s+(\d[A-Z]{2})\b/gi, "$1$2 $3");
  // “PL2 1 QG” → “PL2 1QG”
  v = v.replace(/\b([A-Z]{1,2}\d[A-Z\d]?)\s+(\d)\s+([A-Z]{2})\b/gi, "$1 $2$3");

  // Jammed string ending in a postcode with no spaces: …PlymouthPL21QG
  v = v.replace(
    /([A-Za-z])([A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/i,
    "$1 $2",
  );

  // Standard outward + inward postcode spacing
  v = v.replace(/\b([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})\b/gi, "$1 $2");

  // Comma before postcode: “Plymouth PL2 1QG” → “Plymouth, PL2 1QG”
  v = v.replace(/\s+([A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2})\b/i, ", $1");

  // Comma after street type when town follows: “Kent Road Plymouth,” → “Kent Road, Plymouth,”
  v = v.replace(
    /\b(Road|Street|Lane|Avenue|Close|Drive|Way|Hill|Grove|Terrace|Crescent|Walk|Place|Gardens?)\s+([A-Z][a-z]{2,})\s*,/i,
    "$1, $2,",
  );

  return v.replace(/\s+/g, " ").replace(/,\s*,+/g, ",").trim();
}

/** Best-effort town/city from a UK street address (for map bias). */
export function townFromUkAddress(address: string): string | undefined {
  const v = softNormalizeUkAddress(address);
  if (!v) return undefined;
  const withoutPc = v
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "")
    .replace(/,\s*,+/g, ",")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
  if (!withoutPc) return undefined;
  const commaParts = withoutPc
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return commaParts[commaParts.length - 1];
  }
  // “41 Kent Road Plymouth” → Plymouth
  const tokens = withoutPc.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return tokens[tokens.length - 1];
  return withoutPc;
}

/**
 * Soft check before geocoding. Empty is fine (no warning).
 * Returns a short tip when the value is likely to confuse the map.
 */
export function addressFormatWarning(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  if (/\b(UK|U\.K\.|United Kingdom)\b/i.test(v)) {
    return "Drop “UK” / “United Kingdom” — use street, town and postcode only (e.g. 12 High Street, Bristol BS1 4DJ).";
  }

  if (/,\s*(England|Scotland|Wales|Northern Ireland)\s*,/i.test(v)) {
    return "Leave out the country name — street, town and postcode are enough for the map.";
  }

  if (!/\s/.test(v) && v.length > 10) {
    return "Add spaces (e.g. 12 High Street, Bristol BS1 4DJ) so the map can find you.";
  }

  const hasPostcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(v);
  if (hasPostcode) return null;

  // Postcode-only is already handled above; bare town / vague text
  if (!/\d/.test(v) && v.split(/[\s,]+/).length < 3) {
    return "Too vague for a reliable pin — add street number and postcode (e.g. 12 High Street, Bristol BS1 4DJ).";
  }

  if (!hasPostcode) {
    return "Add a UK postcode if you can (e.g. … Bristol BS1 4DJ) — the map finds those most reliably.";
  }

  return null;
}
