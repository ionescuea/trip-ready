/** Shown in every address field — matches what Nominatim/OSRM resolve reliably. */
export const ADDRESS_PLACEHOLDER = "41 Kent Road, Plymouth PL2 1QG";

export const ADDRESS_FORMAT_HINT =
  "Format: number + street, town, postcode — e.g. 41 Kent Road, Plymouth PL2 1QG. Don’t add UK.";

/**
 * Soft check before geocoding. Empty is fine (no warning).
 * Returns a short tip when the value is likely to confuse the map.
 */
export function addressFormatWarning(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  if (/\b(UK|U\.K\.|United Kingdom)\b/i.test(v)) {
    return "Drop “UK” / “United Kingdom” — use street, town and postcode only (e.g. 41 Kent Road, Plymouth PL2 1QG).";
  }

  if (/,\s*(England|Scotland|Wales|Northern Ireland)\s*,/i.test(v)) {
    return "Leave out the country name — street, town and postcode are enough for the map.";
  }

  const hasPostcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(v);
  if (hasPostcode) return null;

  // Postcode-only is already handled above; bare town / vague text
  if (!/\d/.test(v) && v.split(/[\s,]+/).length < 3) {
    return "Too vague for a reliable pin — add street number and postcode (e.g. 41 Kent Road, Plymouth PL2 1QG).";
  }

  if (!hasPostcode) {
    return "Add a UK postcode if you can (e.g. … Plymouth PL2 1QG) — the map finds those most reliably.";
  }

  return null;
}
