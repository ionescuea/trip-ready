/** Resolve a departure airport string into something geocoders understand. */
const AIRPORT_ALIASES: Record<string, string> = {
  LGW: "London Gatwick Airport, UK",
  LHR: "London Heathrow Airport, UK",
  STN: "London Stansted Airport, UK",
  LTN: "London Luton Airport, UK",
  LCY: "London City Airport, UK",
  MAN: "Manchester Airport, UK",
  BHX: "Birmingham Airport, UK",
  EDI: "Edinburgh Airport, UK",
  GLA: "Glasgow Airport, UK",
  BRS: "Bristol Airport, UK",
  EXT: "Exeter Airport, UK",
  NQY: "Newquay Airport, UK",
  NCL: "Newcastle Airport, UK",
  LBA: "Leeds Bradford Airport, UK",
  EMA: "East Midlands Airport, UK",
  CWL: "Cardiff Airport, UK",
  SOU: "Southampton Airport, UK",
  BOH: "Bournemouth Airport, UK",
  ATH: "Athens International Airport, Greece",
};

const NAME_ALIASES: { match: RegExp; query: string }[] = [
  { match: /\bgatwick\b/i, query: AIRPORT_ALIASES.LGW },
  { match: /\bheathrow\b/i, query: AIRPORT_ALIASES.LHR },
  { match: /\bstansted\b|\bstanstead\b/i, query: AIRPORT_ALIASES.STN },
  { match: /\bluton\b/i, query: AIRPORT_ALIASES.LTN },
  { match: /\bbristol\b/i, query: AIRPORT_ALIASES.BRS },
  { match: /\bexeter\b/i, query: AIRPORT_ALIASES.EXT },
  { match: /\bnewquay\b|\bcornwall\b/i, query: AIRPORT_ALIASES.NQY },
  { match: /\bmanchester\b/i, query: AIRPORT_ALIASES.MAN },
  { match: /\bbirmingham\b/i, query: AIRPORT_ALIASES.BHX },
  { match: /\bedinburgh\b/i, query: AIRPORT_ALIASES.EDI },
  { match: /\bglasgow\b/i, query: AIRPORT_ALIASES.GLA },
  { match: /\bcardiff\b/i, query: AIRPORT_ALIASES.CWL },
  { match: /\bsouthampton\b/i, query: AIRPORT_ALIASES.SOU },
  { match: /\bbournemouth\b/i, query: AIRPORT_ALIASES.BOH },
  { match: /\bathens\b/i, query: AIRPORT_ALIASES.ATH },
];

export function resolveAirportQuery(raw?: string): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");

  // Exact / embedded IATA only when it is a known code (avoids "Bri" → junk)
  const code = cleaned.toUpperCase().match(/\b([A-Z]{3})\b/)?.[1];
  if (code && AIRPORT_ALIASES[code]) return AIRPORT_ALIASES[code];

  for (const alias of NAME_ALIASES) {
    if (alias.match.test(cleaned)) return alias.query;
  }

  // Reject short / ambiguous fragments like "Bri"
  if (cleaned.length < 4) return null;

  if (/airport/i.test(cleaned)) {
    return /,\s*uk$/i.test(cleaned) ? cleaned : `${cleaned}, UK`;
  }

  return `${cleaned} Airport, UK`;
}

export function getTripAirportLabel(
  driveAirport?: string,
  departureAirport?: string,
  parkingAirport?: string,
): string {
  return (
    driveAirport?.trim() ||
    departureAirport?.trim() ||
    parkingAirport?.trim() ||
    ""
  );
}

export const AIRPORT_SUGGESTIONS = [
  "Exeter (EXT)",
  "Bristol (BRS)",
  "London Gatwick (LGW)",
  "London Heathrow (LHR)",
  "Newquay (NQY)",
  "Manchester (MAN)",
  "Birmingham (BHX)",
];
