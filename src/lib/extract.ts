import type { BookingDetails, BookingType } from "./types";
import {
  buildUsefulInfo,
  emptyDetails,
  isAutoConfirmed,
  parseBookingStatus,
  splitDateTime,
} from "./bookingDetails";
import { extractParkingDates, extractStayDates, formatDateDMY, parseFlexibleDate } from "./dates";
import { defaultArriveEarlyMinutes, extractArriveEarlyMinutes } from "./arriveEarly";
import { enrichParkingFields } from "./parking";
import { normalizeExtractedText } from "./pdfText";

export type ExtractResult = {
  type: BookingType;
  fields: BookingDetails;
  confidence: "high" | "medium" | "low";
  notes: string[];
  autoConfirmed: boolean;
};

function findMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Safari-safe RegExp matchAll (avoids for-of on undefined). */
function matchAllSafe(text: string, re: RegExp): RegExpExecArray[] {
  if (typeof text.matchAll === "function") {
    try {
      return Array.from(text.matchAll(re));
    } catch {
      /* fall through */
    }
  }
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    out.push(m);
    if (!r.global) break;
  }
  return out;
}

function findAllNames(text: string): string[] {
  const patterns = [
    /(?:passengers?|travellers?|travelers?|guests?|lead passenger|party)\s*[:\-]\s*([^\n]{3,200})/i,
    /(?:driver)\s*[:\-]\s*([^\n]{3,80})/i,
  ];
  for (const pattern of patterns) {
    const block = text.match(pattern);
    if (!block?.[1]) continue;
    const names = block[1]
      .split(/[,;/&]+|\band\b/i)
      .map((n) => n.replace(/^(mrs?|ms|miss|dr)\.?\s+/i, "").trim())
      .filter(
        (n) =>
          n.length > 1 &&
          n.length < 60 &&
          !/car park|airport|reference|adult|child|room/i.test(n) &&
          /[A-Za-z]{2,}/.test(n),
      );
    if (names.length) return names;
  }
  return [];
}

function looksLikeFlightNumber(text: string): boolean {
  return (
    /\b(?:flight(?:\s*number)?|operates?)\s*[:\-]?\s*[A-Z0-9]{2}\s?\d{2,4}\b/i.test(text) ||
    /\b(?:U2|BA|EZY|FR|LS|W6|A3|BY|LS|TOM)\s?\d{2,4}\b/i.test(text)
  );
}

type Scores = { flight: number; hotel: number; parking: number };

function scoreTypes(text: string): Scores {
  const t = text.toLowerCase();
  return {
    parking:
      Number(/car park|parking|park and go|park & go|park\s*&\s*fly|meet and greet|park\s*&\s*ride/i.test(t)) *
        4 +
      Number(/car registration|car make|driver\s*:/i.test(t)) * 3 +
      Number(/\bshuttle\b|oakwood parking/i.test(t)) * 2 +
      Number(/\bdeparture\b/.test(t) && /\breturn\b/.test(t) && /parking|car park/i.test(t)) * 3,
    hotel:
      Number(/\bhotel\b|accommodation|guest house|resort|check[\s-]?in|check[\s-]?out|holiday summary/i.test(t)) *
        3 +
      Number(/reservation for your stay|room type|board basis|bed and breakfast|half board|your room and board/i.test(t)) *
        2 +
      Number(/\bnights?\b/i.test(t) && !/parking|car park/i.test(t)) * 2 +
      Number(/holiday reference/i.test(t)) * 2,
    flight:
      Number(/\bflights?\b|boarding|e-ticket|\bpnr\b|boarding pass|outbound|inbound|flight reference/i.test(t)) *
        4 +
      Number(looksLikeFlightNumber(text)) * 3 +
      Number(/\b(departing|departure airport|arrival airport)\b/i.test(t)) * 2 +
      Number(/\([A-Z]{3}\s*\)\s*[A-Za-z ].*\([A-Z]{3}\s*\)/.test(text)) * 3 +
      Number(/\bgate\b/i.test(t) && !/parking|car park/i.test(t)),
  };
}

function presentTypes(scores: Scores): BookingType[] {
  const threshold = 3;
  const found: BookingType[] = [];
  if (scores.flight >= threshold) found.push("flight");
  if (scores.hotel >= threshold) found.push("hotel");
  if (scores.parking >= threshold) found.push("parking");
  return found;
}

function findHolidayRefs(text: string): { holidayRef?: string; flightRef?: string } {
  return {
    holidayRef: text.match(/Holiday reference\s+([A-Z0-9-]+)/i)?.[1],
    flightRef: text.match(/Flight reference\s+([A-Z0-9-]+)/i)?.[1],
  };
}

function findBookingNumber(text: string): string | undefined {
  const refs = findHolidayRefs(text);
  return (
    refs.flightRef ||
    refs.holidayRef ||
    findMatch(text, [
      /(?:booking\s*)?(?:reference|ref)[:\s#]*([A-Z0-9-]{5,20})/i,
      /(?:confirmation(?: number| code)?|booking(?: number)?)[:\s#]*([A-Z0-9-]{5,20})/i,
      /\bPNR[:\s#]*([A-Z0-9]{5,8})\b/i,
    ])
  );
}

function findPassengerTitles(text: string): string[] {
  const names = matchAllSafe(
    text,
    /\b(?:Mrs?|Ms|Miss|Dr)\.?\s+([A-Z][a-zA-Z' -]+?)(?=\s*(?:Small under seat|Adult|Child|\n|$))/g,
  )
    .map((m) => (m[1] ?? "").trim())
    .filter((n) => n.length > 2 && n.length < 60 && !/cabin|bag|hold/i.test(n));
  return [...new Set(names)];
}

type FlightLeg = {
  date: string;
  departTime: string;
  arriveTime: string;
  fromCode: string;
  toCode: string;
  fromName: string;
  toName: string;
};

/** easyJet Holidays style: date, then "06:10 11:55", then "Bristol (BRS ) Athens (ATH )" */
function parseEasyJetFlightLegs(text: string): FlightLeg[] {
  const flat = text.replace(/\r\n/g, "\n");
  const re =
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+([A-Za-z][A-Za-z ]*?)\(\s*([A-Z]{3})\s*\)\s+([A-Za-z][A-Za-z ]*?)\(\s*([A-Z]{3})\s*\)/gi;

  const legs: FlightLeg[] = [];
  for (const m of matchAllSafe(flat.replace(/\n+/g, " "), re)) {
    const parsed = parseFlexibleDate(`${m[1]} ${m[2]} ${m[3]}`);
    legs.push({
      date: parsed ? formatDateDMY(parsed) : `${m[1]} ${m[2]} ${m[3]}`,
      departTime: m[4],
      arriveTime: m[5],
      fromName: m[6].trim(),
      fromCode: m[7],
      toName: m[8].trim(),
      toCode: m[9],
    });
  }
  return legs;
}

function isHolidayPackage(text: string): boolean {
  return (
    (/holiday reference/i.test(text) && /flight reference/i.test(text)) ||
    (/your holiday summary/i.test(text) && /\bflights\b/i.test(text))
  );
}

/** Dedicated parser for easyJet Holidays (and similar) combined PDFs. */
function extractHolidayPackage(text: string): ExtractResult[] {
  const refs = findHolidayRefs(text);
  const legs = parseEasyJetFlightLegs(text);
  const outbound = legs[0];
  const inbound = legs[1];
  const people = findPassengerTitles(text).join(", ") || findAllNames(text).join(", ");
  const holdBags = findMatch(text, [/(\d+\s*x\s*\d+\s*kg\s*hold\s*bag)/i, /(\d+\s*x\s*\d+\s*kg)/i]);
  const cabinBags = /small under seat cabin bag/i.test(text)
    ? "1 small under-seat cabin bag per person"
    : undefined;
  const arriveEarlyFromText = extractArriveEarlyMinutes(text);
  const arriveEarly =
    arriveEarlyFromText ??
    defaultArriveEarlyMinutes({
      arrivalAirport: outbound?.toCode,
      destination: outbound?.toName || "Greece",
      hasHoldBags: Boolean(holdBags),
    });
  const transfer = /private transfers?/i.test(text) ? "Private transfers" : undefined;
  const transferMins = text.match(/approx\.?\s*(\d+)\s*mins?/i)?.[1];

  const hotelName =
    findMatch(text, [
      /YOUR HOLIDAY SUMMARY\s+([A-Z][^\n]{2,80})/i,
      /\b([A-Z][A-Za-z0-9'& -]{2,50}\s+Hotel)\b/,
    ])?.replace(/\s+Athens.*/i, "").trim() || "Hotel";

  const stay = extractStayDates(text);
  const board = findMatch(text, [
    /\b(Bed and Breakfast|All Inclusive|Half Board|Full Board|Room Only|Self Catering)\b/i,
  ]);
  const room = findMatch(text, [
    /\b(Triple deluxe|Double deluxe|Twin(?: room)?|Family room|Studio)[^\n]{0,20}/i,
  ]);
  const address = findMatch(text, [
    /(\d{1,4}\s+[A-Za-z][^\n]{5,60}\d{3}\s*\d{2})/,
  ]);

  const status = statusFromText(text, "confirmed");

  const flight: ExtractResult = {
    type: "flight",
    fields: emptyDetails({
      name: outbound
        ? `easyJet · ${outbound.fromCode} → ${outbound.toCode}`
        : "easyJet holiday flights",
      number: refs.flightRef || refs.holidayRef,
      startDate: outbound?.date || stay.checkIn,
      endDate: inbound?.date || stay.checkOut || outbound?.date,
      startTime: outbound?.departTime,
      endTime: inbound?.departTime || outbound?.arriveTime,
      status,
      people,
      departureAirport: outbound?.fromCode,
      arrivalAirport: outbound?.toCode,
      cabinBags,
      holdBags,
      // Only store when the confirmation actually stated it — leave-by treats this as booking fact
      arriveEarlyMinutes: arriveEarlyFromText != null ? String(arriveEarlyFromText) : undefined,
      usefulInfo: buildUsefulInfo([
        refs.holidayRef ? `Holiday ref: ${refs.holidayRef}` : undefined,
        arriveEarlyFromText != null
          ? `Arrive early (from booking): ${Math.round(arriveEarlyFromText / 60)} hours before departure`
          : `Arrive early (default — not stated on booking): ${Math.round(arriveEarly / 60)} hours before departure`,
        outbound
          ? `Outbound: ${outbound.fromName} (${outbound.fromCode}) ${outbound.departTime} → ${outbound.toName} (${outbound.toCode}) ${outbound.arriveTime}`
          : undefined,
        inbound
          ? `Return: ${inbound.fromName} (${inbound.fromCode}) ${inbound.departTime} → ${inbound.toName} (${inbound.toCode}) ${inbound.arriveTime}`
          : undefined,
        cabinBags,
        holdBags ? `Hold bags: ${holdBags}` : undefined,
        transfer
          ? `Transfer: ${transfer}${transferMins ? ` (~${transferMins} min)` : ""}`
          : undefined,
      ]),
    }),
    confidence: outbound ? "high" : "medium",
    notes: ["Parsed as easyJet Holidays package (flights)."],
    autoConfirmed: true,
  };

  const hotel: ExtractResult = {
    type: "hotel",
    fields: emptyDetails({
      name: hotelName,
      number: refs.holidayRef || refs.flightRef,
      startDate: stay.checkIn || outbound?.date,
      endDate: stay.checkOut || inbound?.date,
      startTime: "15:00",
      endTime: "11:00",
      status,
      people,
      usefulInfo: buildUsefulInfo([
        stay.nights ? `${stay.nights} nights` : undefined,
        room ? `Room: ${room}` : undefined,
        board ? `Board: ${board}` : undefined,
        address ? `Address: ${address}` : undefined,
        refs.flightRef ? `Flight ref: ${refs.flightRef}` : undefined,
      ]),
    }),
    confidence: hotelName !== "Hotel" && (stay.checkIn || outbound) ? "high" : "medium",
    notes: [
      "Parsed as easyJet Holidays package (hotel).",
      ...(stay.note ? [stay.note] : []),
    ],
    autoConfirmed: true,
  };

  return [flight, hotel];
}

function statusFromText(text: string, explicit?: string) {
  return parseBookingStatus(
    [
      explicit,
      text.match(
        /(paid in full|fully paid|balance due|deposit paid|awaiting payment|payment received|booking confirmed|reservation confirmed|confirmed|booked)/i,
      )?.[1],
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Pull a likely section for a booking type from a combined holiday PDF. */
function sectionFor(type: BookingType, text: string): string {
  const markers: Record<BookingType, RegExp> = {
    flight:
      /(?:flight details|your flights?|outbound|inbound|flight itinerary|flights included)/i,
    hotel:
      /(?:accommodation|hotel details|your hotel|your stay|check[\s-]?in|room type)/i,
    parking:
      /(?:car park|parking details|park and go|parking summary)/i,
    experience:
      /(?:enjoy your experience|ticket info|meeting point|guided tour|day trip)/i,
    other: /^/,
  };

  const start = text.search(markers[type]);
  if (start < 0) return text;

  const others = (["flight", "hotel", "parking", "experience"] as BookingType[])
    .filter((t) => t !== type)
    .map((t) => {
      const idx = text.slice(start + 10).search(markers[t]);
      return idx < 0 ? text.length : start + 10 + idx;
    });
  const end = Math.min(...others, text.length);
  const slice = text.slice(start, end).trim();
  // If section is tiny, fall back to full text
  return slice.length > 80 ? slice : text;
}

function extractFlight(text: string, notes: string[]): ExtractResult {
  const airline = findMatch(text, [
    /(?:airline|operated by|carrier)[:\s]+([A-Za-z ]{2,40})/i,
    /\b(easyJet|Ryanair|British Airways|BA|Aegean|Jet2|TUI|Wizz Air|Thomson|Thomas Cook)\b/i,
  ]);
  const flightNumber = findMatch(text, [
    /(?:flight(?: number)?)[:\s]*([A-Z]{2}\s?\d{2,4})/i,
    /\b((?:U2|BA|EZY|FR|LS|W6|A3|BY|TOM)\s?\d{2,4})\b/i,
  ]);
  const departureAirport = findMatch(text, [
    /\bfrom[:\s]+[^(]*\(([A-Z]{3})\)/i,
    /(?:from|depart(?:ing|ure)?(?: airport)?)[:\s]+([A-Z]{3})\b/i,
    /(?:from|depart(?:ing|ure)?(?: airport)?)[:\s]+([A-Za-z][A-Za-z '-]{2,40}(?:Airport)?)/i,
  ]);
  const arrivalAirport = findMatch(text, [
    /(?:to|arriv(?:ing|al)?(?: airport)?)[:\s]+[^(]*\(([A-Z]{3})\)/i,
    /(?:to|arriv(?:ing|al)?(?: airport)?)[:\s]+([A-Z]{3})\b/i,
    /(?:to|arriv(?:ing|al)?(?: airport)?)[:\s]+([A-Za-z][A-Za-z '-]{2,40}(?:Airport)?)/i,
  ]);
  const departureAt = findMatch(text, [
    /(?:outbound|depart(?:ure)?(?: date| time)?)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+at\s+|\s+)[0-9]{1,2}:[0-9]{2})/i,
    /(?:outbound|depart(?:ure)?(?: date| time)?)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:[,\s]+[0-9]{1,2}:[0-9]{2})?)/i,
    /\b([0-9]{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+[0-9]{4}(?:\s+at\s+[0-9]{1,2}:[0-9]{2})?)/i,
  ]);
  const returnAt = findMatch(text, [
    /(?:return|inbound)(?:\s+flight)?(?:\s+date|\s+time)?[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+at\s+|\s+)?[0-9]{0,2}:?[0-9]{0,2})/i,
    /(?:return|inbound)[:\s]+([0-9]{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+[0-9]{4}(?:\s+at\s+[0-9]{1,2}:[0-9]{2})?)/i,
  ]);
  const arrivalAt = findMatch(text, [
    /(?:arriv(?:al|e)(?: date| time)?)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+at\s+|\s+)[0-9]{1,2}:[0-9]{2})/i,
    /(?:arriv(?:al|e)(?: date| time)?)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:[,\s]+[0-9]{1,2}:[0-9]{2})?)/i,
  ]);
  const dep = splitDateTime(departureAt);
  const ret = splitDateTime(returnAt);
  const arr = splitDateTime(arrivalAt);
  const cabinBags = findMatch(text, [
    /(?:cabin(?: bag| baggage)?|hand luggage)[:\s]+([^\n.]{3,60})/i,
    /(\d+\s*x?\s*cabin)/i,
  ]);
  const holdBags = findMatch(text, [
    /(?:hold(?: bag| baggage)?|checked bag(?:gage)?)[:\s]+([^\n.]{3,60})/i,
    /(\d+\s*x?\s*(?:hold|checked))/i,
  ]);
  const people = findAllNames(text).join(", ");
  const number = findBookingNumber(text);
  const status = statusFromText(text);
  const arriveEarlyFromText = extractArriveEarlyMinutes(text);
  const name = [
    airline,
    flightNumber,
    departureAirport && arrivalAirport
      ? `${departureAirport} → ${arrivalAirport}`
      : departureAirport,
  ]
    .filter(Boolean)
    .join(" · ");

  const fields = emptyDetails({
    name: name || "Flight",
    number,
    startDate: dep.date,
    endDate: ret.date || arr.date || dep.date,
    startTime: dep.time,
    endTime: ret.time || arr.time,
    status,
    people,
    departureAirport,
    arrivalAirport,
    cabinBags,
    holdBags,
    arriveEarlyMinutes: arriveEarlyFromText != null ? String(arriveEarlyFromText) : undefined,
    usefulInfo: buildUsefulInfo([
      arriveEarlyFromText != null
        ? `Arrive early (from booking): ${Math.round(arriveEarlyFromText / 60)} hours before departure`
        : undefined,
      cabinBags ? `Cabin bags: ${cabinBags}` : undefined,
      holdBags ? `Hold bags: ${holdBags}` : undefined,
      findMatch(text, [/(?:terminal)[:\s]+([A-Z0-9]+)/i])
        ? `Terminal: ${findMatch(text, [/(?:terminal)[:\s]+([A-Z0-9]+)/i])}`
        : undefined,
    ]),
  });

  if (arriveEarlyFromText != null) {
    notes.push(`Booking says arrive ${Math.round(arriveEarlyFromText / 60)}h early — used for leave-by.`);
  } else {
    notes.push("No arrive-early line on this flight booking — leave-by will use a route default.");
  }

  if (!fields.number) notes.push("Flight: could not find booking number.");
  if (!fields.startDate) notes.push("Flight: departure date unclear.");
  const filled = [fields.name, fields.number, fields.startDate, fields.startTime, fields.people].filter(
    Boolean,
  ).length;
  return {
    type: "flight",
    fields,
    confidence: filled >= 4 ? "high" : filled >= 2 ? "medium" : "low",
    notes,
    autoConfirmed: isAutoConfirmed(status),
  };
}

function extractHotel(text: string, notes: string[]): ExtractResult {
  const stay = extractStayDates(text);
  const propertyName = findMatch(text, [
    /(?:property|hotel name|accommodation|hotel)\s*[:\-]\s*([^\n]{3,80})/i,
    /(?:welcome to|reservation at|staying at)\s+([^\n]{3,60})/i,
    /\b((?:[A-Z][\w'&-]+(?:\s+[A-Z][\w'&-]+){0,5})\s+(?:Hotel|Resort|Apartments?|Villa))\b/,
  ]);
  const number = findBookingNumber(text);
  const remainingBalance = findMatch(text, [
    /(?:balance(?: due| remaining)?|amount due)[:\s]+([£$€]?\s?[0-9,]+\.?[0-9]*)/i,
  ]);
  const totalAmount = findMatch(text, [
    /(?:total(?: price| amount)?)[:\s]+([£$€]?\s?[0-9,]+\.?[0-9]*)/i,
  ]);
  const board = findMatch(text, [
    /(?:board(?: basis)?|meal basis)\s*[:\-]?\s*([^\n]{3,40})/i,
    /\b(all inclusive|half board|full board|bed and breakfast|room only|self catering)\b/i,
  ]);
  const room = findMatch(text, [/(?:room(?: type)?)\s*[:\-]?\s*([^\n]{3,60})/i]);
  const status = statusFromText(
    text,
    remainingBalance ? `balance due ${remainingBalance}` : undefined,
  );
  const people = findAllNames(text).join(", ");

  const fields = emptyDetails({
    name: propertyName || "Hotel",
    number,
    startDate: stay.checkIn,
    endDate: stay.checkOut,
    startTime: "15:00",
    endTime: "11:00",
    status,
    people,
    remainingBalance,
    usefulInfo: buildUsefulInfo([
      stay.nights ? `${stay.nights} nights` : undefined,
      room ? `Room: ${room}` : undefined,
      board ? `Board: ${board}` : undefined,
      totalAmount ? `Total: ${totalAmount}` : undefined,
      remainingBalance ? `Balance: ${remainingBalance}` : undefined,
    ]),
  });

  if (stay.note) notes.push(`Hotel: ${stay.note}`);
  if (!fields.startDate) notes.push("Hotel: could not find check-in date.");
  if (!fields.endDate) notes.push("Hotel: could not find check-out date.");
  if (status === "unpaid") notes.push("Hotel: looks unpaid / balance due.");
  const filled = [fields.name, fields.number, fields.startDate, fields.endDate].filter(Boolean).length;
  return {
    type: "hotel",
    fields,
    confidence: filled >= 3 ? "high" : filled >= 2 ? "medium" : "low",
    notes,
    autoConfirmed: isAutoConfirmed(status),
  };
}

function extractParking(text: string, notes: string[]): ExtractResult {
  const dates = extractParkingDates(text);
  const entry = splitDateTime(dates.entryAt);
  const exit = splitDateTime(dates.exitAt);
  const carParkName = findMatch(text, [
    /(?:car park|parking product|product name)\s*[:\-]\s*([^\n]{3,60})/i,
    /(?:order for|thank you for your order for)\s+([^\n]{3,60})/i,
    /\b((?:Oakwood|Holiday Extras|Purple Parking|MAP|APH|Looking4|NCP)[^\n]{0,40})/i,
    /\b((?:South|North|East|West)?\s*Terminal\s+Long Stay)\b/i,
    /\b([A-Za-z0-9][A-Za-z0-9 &'/-]{2,40}\s+Long Stay)\b/i,
  ]);
  const airport = findMatch(text, [
    /(?:airport)\s*[:\-]\s*([A-Za-z][A-Za-z ]{2,40})/i,
    /\b((?:Heathrow|Gatwick|Stansted|Stanstead|Luton|Manchester|Birmingham|Edinburgh|Bristol|Exeter|Newquay|Cardiff|Southampton|Bournemouth)(?:\s+Airport)?)\b/i,
    /\(([A-Z]{3})\)/,
  ]);
  const vehicleReg = findMatch(text, [
    /(?:car\s*)?(?:registration|vehicle|VRM|number plate)\s*[:\-]?\s*([A-Z0-9 ]{5,10})/i,
  ]);
  const carModel = findMatch(text, [
    /(?:car make\/model|make\/model|vehicle)\s*[:\-]?\s*([^\n]{3,40})/i,
  ]);
  const totalPrice = findMatch(text, [
    /(?:total price|total)\s*[:\-]?\s*([£$€]?\s?[0-9,]+\.?[0-9]*)/i,
  ]);
  const people = findAllNames(text).join(", ");

  const base = enrichParkingFields(
    text,
    emptyDetails({
      name: carParkName,
      airport,
      number: findBookingNumber(text),
      vehicleReg,
      people,
      startDate: entry.date,
      endDate: exit.date,
      startTime: entry.time,
      endTime: exit.time,
      status: statusFromText(text),
    }),
  );

  if (
    !base.shuttleIncluded &&
    /oakwood|park and go|lulsgate|off[- ]?airport/i.test(`${text} ${carParkName ?? ""}`)
  ) {
    base.shuttleIncluded = "yes";
    const oakwood = /oakwood/i.test(`${text} ${carParkName ?? ""}`);
    base.shuttleDetails =
      base.shuttleDetails ||
      (oakwood
        ? "Short shuttle / transfer — about 5 minutes to the terminal"
        : "Shuttle / transfer to airport terminal");
    base.locationRelative =
      base.locationRelative ||
      (oakwood
        ? "Near Bristol Airport — about 5 minutes to the terminal"
        : "Off-airport parking — transfer/shuttle to terminal");
    base.transferMinutes = base.transferMinutes || (oakwood ? "5" : "35");
  } else if (!base.transferMinutes) {
    base.transferMinutes = "30";
  }

  const fields = emptyDetails({
    ...base,
    name: base.name || [base.airport, "Parking"].filter(Boolean).join(" · "),
    usefulInfo: buildUsefulInfo([
      base.airport ? `Airport: ${base.airport}` : undefined,
      base.locationRelative,
      base.terminal ? `Terminal: ${base.terminal}` : undefined,
      base.shuttleDetails ||
        (base.shuttleIncluded?.toLowerCase().startsWith("yes")
          ? "Shuttle to terminal included"
          : base.shuttleIncluded),
      base.transferMinutes ? `Transfer buffer: ${base.transferMinutes} min` : undefined,
      carModel ? `Car: ${carModel}` : undefined,
      base.vehicleReg ? `Registration: ${base.vehicleReg}` : undefined,
      totalPrice ? `Total: ${totalPrice}` : undefined,
      /cancellation waiver included/i.test(text) ? "Cancellation waiver included" : undefined,
    ]),
  });

  if (dates.note) notes.push(dates.note);
  if (!fields.startDate) notes.push("Parking entry date unclear.");
  if (!fields.endDate) notes.push("Parking exit date unclear.");
  if (fields.shuttleIncluded?.toLowerCase().startsWith("yes")) {
    notes.push(
      `Shuttle/transfer to terminal noted (${fields.transferMinutes ?? "?"} min). Included in leave-by.`,
    );
  }
  const filled = [fields.name, fields.number, fields.startDate, fields.endDate].filter(Boolean).length;
  return {
    type: "parking",
    fields,
    confidence: filled >= 3 ? "high" : filled >= 2 ? "medium" : "low",
    notes,
    autoConfirmed: isAutoConfirmed(fields.status),
  };
}

function isExperienceConfirmation(text: string): boolean {
  const t = text.toLowerCase();
  return (
    (/enjoy your experience|tui musement|tui-experiences|tuimusement/i.test(t) ||
      /guided tour|day trip|street food|full-day cruise|meeting point/i.test(t)) &&
    /ticket info|download (?:your )?(?:voucher|ticket)|order is complete/i.test(t) &&
    !/boarding pass|flight reference|car park|holiday reference/i.test(t)
  );
}

/** Parse “Monday, 21 Sep 2026, 3:00 PM” / “Thursday, 24 Sep 2026, 8:00 AM”. */
function parseExperienceDateTime(raw: string): { date?: string; time?: string } {
  const s = raw
    .trim()
    .replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*/i, "")
    .replace(/\s+/g, " ");
  const ampm = s.match(
    /^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i,
  );
  if (ampm) {
    const base = parseFlexibleDate(ampm[1]!);
    if (!base) return {};
    let hour = Number(ampm[2]);
    const minute = Number(ampm[3]);
    const mer = ampm[4]!.toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    return {
      date: formatDateDMY(base),
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  }
  const d = parseFlexibleDate(s);
  if (!d) return {};
  const hasTime = /\d{1,2}:\d{2}/.test(s);
  return {
    date: formatDateDMY(d),
    time: hasTime
      ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      : undefined,
  };
}

function extractExperience(text: string, notes: string[]): ExtractResult {
  const name =
    findMatch(text, [
      /Enjoy your experience\s*[-–—]\s*([^\n]{5,120})/i,
      /Subject:\s*Confirmed!\s*Enjoy your experience\s*[-–—]\s*([^\n]{5,120})/i,
      /(?:^|\n)([^\n]{5,100})\n\1/i, // duplicated tour title in Musement emails
    ])?.replace(/\s+/g, " ").trim() || "Day trip / experience";

  const whenRaw = findMatch(text, [
    /DATE:\s*([^\n]{8,80})/i,
    /Date:\s*([^\n]{8,80})/i,
  ]);
  const when = whenRaw ? parseExperienceDateTime(whenRaw) : {};

  let meeting = findMatch(text, [
    /Meeting point\s*(?:<\/?p>)?\s*([^<\n]{5,120})/i,
    /Meeting point:\s*([^\n]{5,120})/i,
    /Where:\s*Location[^\n]*Meeting point:\s*([^\n]{5,120})/i,
  ]);
  meeting = meeting
    ?.replace(/<\/?p>/gi, "")
    .replace(/Open in Google Maps.*/i, "")
    .trim();

  const tickets = findMatch(text, [
    /(\d+\s*x\s+[^\n]{3,60})/i,
  ]);

  const lead = findMatch(text, [/Hi\s+([A-Za-z][A-Za-z\- ]{1,60}),/i]);

  const includedBlock = text.match(
    /Included:\s*([\s\S]*?)(?:Not included:|Where:|Meeting point|What to remember|Cancellation policy|$)/i,
  )?.[1];
  const notIncludedBlock = text.match(
    /Not included:\s*([\s\S]*?)(?:Where:|Meeting point|What to remember|Cancellation policy|$)/i,
  )?.[1];

  const cleanBullets = (block?: string) =>
    (block ?? "")
      .replace(/Check Mark Icon[^\n]*/gi, "")
      .replace(/<\/?[^>]+>/g, " ")
      .split(/\n+/)
      .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
      .filter((l) => l.length > 2 && l.length < 80)
      .slice(0, 10);

  const included = cleanBullets(includedBlock);
  const notIncluded = cleanBullets(notIncludedBlock);

  const remember: string[] = [];
  if (/print the voucher|Remember to print/i.test(text)) {
    remember.push("Print the voucher (not phone-only).");
  } else if (/smartphone|Don't need to print|do not need to print/i.test(text)) {
    remember.push("Phone voucher is enough — no print needed.");
  }
  if (/without transportation|no hotel pick-up|Not included:[\s\S]*Hotel pick-up/i.test(text)) {
    remember.push("No hotel transfer — make your own way to the meeting point.");
  }
  if (/arrive .*15 minutes|at least 15 minutes/i.test(text)) {
    remember.push("Arrive at least 15 minutes early.");
  }
  if (/wait for 5 minutes|only wait for 5/i.test(text)) {
    remember.push("Guide waits only 5 minutes.");
  }
  if (/skirt|monaster|dress appropriately/i.test(text)) {
    remember.push("Dress code for monasteries — cover knees/shoulders; bring cash for entry fees.");
  }
  if (/€\s*5|5 euros/i.test(text)) {
    remember.push("Monastery entry ~€5 pp each, cash locally.");
  }
  const contact = findMatch(text, [
    /contact the local operator at:\s*([^\n]{5,80})/i,
    /local provider at\s*(\+?[\d\s]{8,20})/i,
  ]);
  if (contact) remember.push(`Local: ${contact}`);

  const usefulBits = [
    tickets ? `Tickets: ${tickets}` : null,
    included.length ? `Included: ${included.join("; ")}` : null,
    notIncluded.length ? `Not included: ${notIncluded.join("; ")}` : null,
    ...remember,
  ].filter(Boolean);

  const fields = emptyDetails({
    name,
    startDate: when.date,
    startTime: when.time,
    status: "confirmed",
    people: lead ? `${lead}${tickets ? ` · ${tickets}` : ""}` : tickets,
    locationRelative: meeting,
    usefulInfo: usefulBits.join("\n") || undefined,
  });

  if (!when.date) notes.push("Experience date unclear — check the confirmation.");
  if (!meeting) notes.push("Meeting point not found — check the voucher.");

  const filled = [fields.name, fields.startDate, fields.startTime, fields.locationRelative].filter(
    Boolean,
  ).length;
  return {
    type: "experience",
    fields,
    confidence: filled >= 3 ? "high" : filled >= 2 ? "medium" : "low",
    notes: [...notes, "Saved as a day trip / experience."],
    autoConfirmed: true,
  };
}

/**
 * Extract every booking type found in a document.
 * A holiday PDF with flights + hotel returns two results.
 */
export function extractAllFromText(rawText: string): ExtractResult[] {
  const text = normalizeExtractedText(rawText.replace(/\r\n/g, "\n"));

  if (isExperienceConfirmation(text)) {
    return [extractExperience(text, [])];
  }

  if (isHolidayPackage(text)) {
    return extractHolidayPackage(text);
  }

  const scores = scoreTypes(text);
  let types = presentTypes(scores);

  // Fallback: pick the single strongest type
  if (types.length === 0) {
    const ranked = (Object.entries(scores) as [BookingType, number][])
      .filter(([k]) => k !== "other" && k !== "experience")
      .sort((a, b) => b[1] - a[1]);
    if (ranked[0]?.[1] > 0) types = [ranked[0][0]];
  }

  if (types.length === 0) {
    return [
      {
        type: "other",
        fields: emptyDetails({
          name: "Other document",
          usefulInfo: text.slice(0, 400),
          status: statusFromText(text),
        }),
        confidence: "low",
        notes: ["Could not classify as flight, hotel, parking, or experience. Saved as other."],
        autoConfirmed: false,
      },
    ];
  }

  const multi = types.length > 1;
  const results: ExtractResult[] = [];
  const sharedNumber = findBookingNumber(text);

  for (const type of types) {
    const slice = multi ? sectionFor(type, text) : text;
    const notes: string[] = multi ? [`Split from combined document → ${type}.`] : [];
    if (type === "flight") results.push(extractFlight(slice, notes));
    else if (type === "hotel") results.push(extractHotel(slice, notes));
    else if (type === "parking") results.push(extractParking(slice, notes));
    else if (type === "experience") results.push(extractExperience(slice, notes));
  }

  // Package PDFs often put one booking ref at the top — apply to all cards
  for (const r of results) {
    if (!r.fields.number && sharedNumber) r.fields.number = sharedNumber;
  }

  return results;
}

/** Local heuristic extractor — single best match (compat). */
export function extractFromText(rawText: string): ExtractResult {
  return extractAllFromText(rawText)[0];
}
