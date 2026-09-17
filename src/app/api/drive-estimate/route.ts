import { NextResponse } from "next/server";
import { softNormalizeUkAddress, isUsableUkTownName } from "@/lib/addressFormat";
import { resolveAirportQuery } from "@/lib/airports";

export const runtime = "nodejs";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

type WaypointIn = {
  id?: string;
  label?: string;
  address: string;
};

type LegOut = {
  fromLabel: string;
  toLabel: string;
  minutes: number;
  distanceKm: number;
};

type OrderedWaypoint = {
  id?: string;
  label: string;
  address: string;
  distanceFromHomeKm: number;
};

function extractUkPostcode(place: string): string | null {
  const m = place.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return m ? m[1].replace(/\s+/, " ").trim() : null;
}

/** Build Nominatim / Google query variants for messy UK addresses. */
function addressQueryCandidates(place: string): string[] {
  const raw = place.trim();
  if (!raw) return [];

  const spaced = softNormalizeUkAddress(raw);
  const noCountry = spaced
    .replace(/\bUnited Kingdom\b/gi, "")
    .replace(/\bUK\b/gi, "")
    .replace(/,\s*,+/g, ",")
    .replace(/^,\s*|,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const postcode = extractUkPostcode(spaced) || extractUkPostcode(raw);
  const candidates: string[] = [];

  // Comma-formatted full address first, then postcode (reliable), then looser forms
  if (noCountry) candidates.push(noCountry);
  if (noCountry && !/united kingdom/i.test(noCountry)) {
    candidates.push(`${noCountry}, United Kingdom`);
  }
  if (postcode) {
    candidates.push(`${postcode}, United Kingdom`);
    candidates.push(postcode);
  }
  // Street + city only (drop postcode) — helps when postcode is mistyped
  if (postcode && noCountry) {
    const withoutPc = noCountry
      .replace(new RegExp(postcode.replace(/\s+/g, "\\s*"), "i"), "")
      .replace(/,\s*,+/g, ",")
      .replace(/^,\s*|,\s*$/g, "")
      .trim();
    if (withoutPc.length > 5) {
      candidates.push(withoutPc);
      candidates.push(`${withoutPc}, United Kingdom`);
    }
  }
  candidates.push(spaced);
  candidates.push(raw);

  return [...new Set(candidates.filter(Boolean))];
}

function placeQuery(place: string): string {
  return addressQueryCandidates(place)[0] ?? place.trim();
}

function shortLabel(display: string, fallback: string): string {
  return display.split(",").slice(0, 2).join(",").trim() || fallback;
}

function destinationQueries(opts: {
  toTown?: string;
  parkingName?: string;
  parkingAirport?: string;
}): string[] {
  const queries: string[] = [];
  const toTown = opts.toTown?.trim();
  const parking = opts.parkingName?.trim();
  const parkAirport = opts.parkingAirport?.trim();

  if (toTown) {
    const resolved = resolveAirportQuery(toTown);
    if (resolved) queries.push(resolved);
    queries.push(placeQuery(toTown));
    queries.push(toTown);
  }

  if (parking && parkAirport) {
    queries.push(`${parking}, ${parkAirport}, UK`);
    queries.push(`${parking}, ${parkAirport}`);
  }
  if (parking) queries.push(`${parking}, UK`);

  return [...new Set(queries.filter(Boolean))];
}

function pointInCorridor(
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  maxKm: number,
): boolean {
  // Distance from point to segment AB via projection, approx in km
  const ab = haversineKm(a, b) || 0.001;
  const ap = haversineKm(a, p);
  const bp = haversineKm(b, p);
  // Outside the corridor if far from both ends and the path isn't roughly A→P→B
  if (ap <= maxKm || bp <= maxKm) return true;
  return ap + bp <= ab + maxKm * 2;
}

async function nominatimSearch(
  params: Record<string, string>,
): Promise<NominatimResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "gb");

  const headers = {
    "User-Agent": "TripReady/0.1 (local prototype; contact=local-dev)",
    Accept: "application/json",
  };

  const res = await fetch(url, { headers, cache: "no-store" });

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    const retry = await fetch(url, { headers, cache: "no-store" });
    if (!retry.ok) return null;
    const retryData = (await retry.json()) as NominatimResult[];
    return retryData[0] ?? null;
  }

  if (!res.ok) return null;
  const data = (await res.json()) as NominatimResult[];
  return data[0] ?? null;
}

async function geocode(query: string): Promise<NominatimResult | null> {
  return nominatimSearch({ q: query });
}

/** Structured UK postcode lookup — more reliable than free-text for PL2 1QG etc. */
async function geocodeUkPostcode(
  postcode: string,
): Promise<NominatimResult | null> {
  const pc = postcode.replace(/\s+/g, " ").trim().toUpperCase();
  if (!pc) return null;
  const structured = await nominatimSearch({
    postalcode: pc,
    country: "United Kingdom",
  });
  if (structured) return structured;
  return geocode(`${pc}, United Kingdom`);
}

/** Try several query shapes; keep distinct lat/lon hits. */
async function geocodeCandidates(
  place: string,
  maxHits = 4,
): Promise<NominatimResult[]> {
  const hits: NominatimResult[] = [];
  const seen = new Set<string>();
  const add = (hit: NominatimResult | null) => {
    if (!hit) return;
    const key = `${Number(hit.lat).toFixed(5)},${Number(hit.lon).toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  const postcode = extractUkPostcode(place);
  if (postcode) {
    add(await geocodeUkPostcode(postcode));
    if (hits.length >= maxHits) return hits;
  }

  for (const q of addressQueryCandidates(place)) {
    const norm = q.replace(/\s+/g, " ").toUpperCase();
    if (
      postcode &&
      (norm === postcode || norm === `${postcode}, UNITED KINGDOM`)
    ) {
      continue;
    }
    add(await geocode(q));
    if (hits.length >= maxHits) break;
  }
  return hits;
}

function pickNearestGeo(
  hits: NominatimResult[],
  near?: { lat: number; lon: number },
): NominatimResult | null {
  if (hits.length === 0) return null;
  if (!near) return hits[0];
  return [...hits].sort(
    (a, b) =>
      haversineKm(near, parseGeo(a)) - haversineKm(near, parseGeo(b)),
  )[0];
}

/**
 * Resolve an address. When `near` is set (home / previous stop), prefer the
 * candidate closest to that point so a bare postcode in the wrong town can’t
 * yank a pick-up 4 hours away overnight.
 */
async function geocodeBest(
  place: string,
  near?: { lat: number; lon: number },
): Promise<NominatimResult | null> {
  return pickNearestGeo(await geocodeCandidates(place), near);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Straight-line km — used to visit pick-ups nearest to home first. */
function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parseGeo(geo: NominatimResult): { lat: number; lon: number } {
  return { lat: Number(geo.lat), lon: Number(geo.lon) };
}

/** Next 01:30 local — typical quiet airport-run window for traffic models. */
function quietDepartureUnix(): number {
  const d = new Date();
  d.setHours(1, 30, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

async function googleMultiLeg(
  points: { query: string; label: string }[],
  apiKey: string,
  nightDrive: boolean,
): Promise<{ driveMinutes: number; distanceKm: number; legs: LegOut[]; fromLabel: string; toLabel: string } | null> {
  if (points.length < 2) return null;

  const origin = points[0].query;
  const destination = points[points.length - 1].query;
  const middle = points.slice(1, -1);

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", apiKey);
  if (middle.length > 0) {
    url.searchParams.set("waypoints", middle.map((p) => p.query).join("|"));
  }
  if (nightDrive) {
    url.searchParams.set("departure_time", String(quietDepartureUnix()));
    url.searchParams.set("traffic_model", "best_guess");
  } else {
    url.searchParams.set("departure_time", "now");
    url.searchParams.set("traffic_model", "best_guess");
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: string;
    routes?: {
      legs?: {
        duration?: { value: number };
        duration_in_traffic?: { value: number };
        distance?: { value: number };
        start_address?: string;
        end_address?: string;
      }[];
    }[];
  };
  if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) return null;

  const legs: LegOut[] = data.routes[0].legs.map((leg, i) => {
    const seconds = nightDrive
      ? (leg.duration?.value ?? leg.duration_in_traffic?.value)
      : (leg.duration_in_traffic?.value ?? leg.duration?.value);
    const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60));
    return {
      fromLabel: shortLabel(leg.start_address ?? "", points[i]?.label ?? origin),
      toLabel: shortLabel(leg.end_address ?? "", points[i + 1]?.label ?? destination),
      minutes,
      distanceKm: Math.round(((leg.distance?.value ?? 0) / 1000) * 10) / 10,
    };
  });

  const driveMinutes = Math.max(
    5,
    legs.reduce((sum, l) => sum + l.minutes, 0),
  );
  const distanceKm =
    Math.round(legs.reduce((sum, l) => sum + l.distanceKm, 0) * 10) / 10;

  return {
    driveMinutes,
    distanceKm,
    legs,
    fromLabel: legs[0]?.fromLabel ?? points[0].label,
    toLabel: legs[legs.length - 1]?.toLabel ?? points[points.length - 1].label,
  };
}

async function osrmMultiLeg(
  points: { geo: NominatimResult; label: string }[],
): Promise<{ driveMinutes: number; distanceKm: number; legs: LegOut[]; fromLabel: string; toLabel: string } | null> {
  if (points.length < 2) return null;

  const coords = points.map((p) => `${p.geo.lon},${p.geo.lat}`).join(";");
  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;
  const routeRes = await fetch(routeUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!routeRes.ok) return null;

  const routeData = (await routeRes.json()) as {
    routes?: {
      duration: number;
      distance: number;
      legs?: { duration: number; distance: number }[];
    }[];
  };
  const route = routeData.routes?.[0];
  if (!route) return null;

  const rawLegs = route.legs ?? [];
  const legs: LegOut[] =
    rawLegs.length > 0
      ? rawLegs.map((leg, i) => ({
          fromLabel: shortLabel(points[i].geo.display_name, points[i].label),
          toLabel: shortLabel(points[i + 1].geo.display_name, points[i + 1].label),
          minutes: Math.max(1, Math.ceil(leg.duration / 60)),
          distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
        }))
      : [
          {
            fromLabel: shortLabel(points[0].geo.display_name, points[0].label),
            toLabel: shortLabel(
              points[points.length - 1].geo.display_name,
              points[points.length - 1].label,
            ),
            minutes: Math.max(5, Math.ceil(route.duration / 60)),
            distanceKm: Math.round((route.distance / 1000) * 10) / 10,
          },
        ];

  const driveMinutes = Math.max(
    5,
    legs.reduce((sum, l) => sum + l.minutes, 0),
  );
  const distanceKm =
    Math.round(legs.reduce((sum, l) => sum + l.distanceKm, 0) * 10) / 10;

  return {
    driveMinutes,
    distanceKm,
    legs,
    fromLabel: legs[0].fromLabel,
    toLabel: legs[legs.length - 1].toLabel,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      fromTown?: string;
      /** Preferred origin (street / postcode) */
      homeAddress?: string;
      toTown?: string;
      airport?: string;
      parkingName?: string;
      parkingAirport?: string;
      nightDrive?: boolean;
      /** Ordered stops between home and parking */
      waypoints?: WaypointIn[];
    };

    const homeAddress = body.homeAddress?.trim()
      ? softNormalizeUkAddress(body.homeAddress.trim())
      : "";
    const fromTownRaw = body.fromTown?.trim();
    const fromTown = isUsableUkTownName(fromTownRaw) ? fromTownRaw : undefined;
    const originRaw = homeAddress || fromTown;
    if (!originRaw) {
      return NextResponse.json(
        { error: "Enter a home address or the town you are travelling from." },
        { status: 400 },
      );
    }

    const nightDrive = Boolean(body.nightDrive);
    const toTown = body.toTown?.trim() || body.airport?.trim();
    const destQueries = destinationQueries({
      toTown,
      parkingName: body.parkingName,
      parkingAirport: body.parkingAirport,
    });
    if (destQueries.length === 0) {
      return NextResponse.json(
        { error: "Enter the town / city you are travelling to." },
        { status: 400 },
      );
    }

    const stopWaypoints = (body.waypoints ?? [])
      .map((w) => ({
        id: w.id,
        label: (w.label ?? "Stop").trim() || "Stop",
        address: w.address?.trim() ?? "",
      }))
      .filter((w) => w.address.length > 0);

    const originPoint = {
      label: homeAddress ? "Home" : fromTown || "Start",
    };

    // Bias home geocode toward the trip’s from-town when both are set —
    // skip when the origin already has a UK postcode (avoids Nominatim
    // rate-limits and bad “1Q”-style town snaps).
    const originPostcode = extractUkPostcode(originRaw);
    let originBias: { lat: number; lon: number } | undefined;
    let townGeo: NominatimResult | null = null;
    if (fromTown && !originPostcode) {
      townGeo = pickNearestGeo(
        await geocodeCandidates(`${fromTown}, United Kingdom`, 2),
      );
      if (townGeo) originBias = parseGeo(townGeo);
    }

    // Geocode home + stops first so we can order nearest-to-home, then route.
    let originGeo = originPostcode
      ? await geocodeUkPostcode(originPostcode)
      : null;
    if (!originGeo) {
      originGeo = await geocodeBest(originRaw, originBias);
    }
    let originNote: string | null = null;
    if (!originGeo && townGeo && fromTown) {
      originGeo = townGeo;
      originNote = `Couldn't pin the exact start street — routing from ${fromTown}. A postcode alone is usually enough.`;
    }
    if (!originGeo) {
      const pc = extractUkPostcode(originRaw);
      return NextResponse.json(
        {
          error: pc
            ? `The map couldn't locate that start address. Try the postcode on its own (${pc}), or write it with commas — e.g. 41 Kent Road, Plymouth ${pc}.`
            : `The map couldn't locate that start address. Add a UK postcode (e.g. PL2 1QG).`,
        },
        { status: 404 },
      );
    }

    // If the start address snapped far from the trip’s from-town (e.g. wrong
    // postcode / placeholder city), route from the town instead — otherwise
    // leave-home jumps back many hours.
    // Never do this when we already have a solid UK postcode origin — a bad
    // from-town like “1Q” used to replace Plymouth with a nonsense pin and
    // skip nearby pick-ups.
    if (originBias && townGeo && !originNote) {
      const snapKm = haversineKm(parseGeo(originGeo), originBias);
      if (snapKm > 60) {
        const originPc = extractUkPostcode(originRaw);
        if (originPc) {
          originNote = `Using start postcode ${originPc} (ignored vague from-town “${fromTownRaw}”).`;
        } else {
          originGeo = townGeo;
          originNote = `Start address mapped ${Math.round(snapKm)} km from ${fromTown} — routing from ${fromTown} instead. Check the driver start postcode.`;
        }
      }
    }
    const originCoords = parseGeo(originGeo);

    // Resolve destination early so we can keep pick-ups on the home→parking corridor
    let destGeo: NominatimResult | null = null;
    let usedQuery = destQueries[0];
    const destHits: { q: string; geo: NominatimResult }[] = [];
    for (const q of destQueries) {
      const geo = await geocode(q);
      if (geo) destHits.push({ q, geo });
    }
    if (destHits.length > 0) {
      const best = [...destHits].sort(
        (a, b) =>
          haversineKm(originCoords, parseGeo(a.geo)) -
          haversineKm(originCoords, parseGeo(b.geo)),
      )[0];
      destGeo = best.geo;
      usedQuery = best.q;
    }
    if (!destGeo) {
      return NextResponse.json(
        {
          error: `Could not find “${toTown || destQueries[0]}”. Try a town, city, or airport name.`,
        },
        { status: 404 },
      );
    }
    const destCoords = parseGeo(destGeo);
    const homeToDestKm = haversineKm(originCoords, destCoords);
    const corridorSlackKm = Math.max(80, homeToDestKm * 0.5);

    const midPoints: {
      id?: string;
      label: string;
      address: string;
      geo: NominatimResult;
      distanceFromHomeKm: number;
    }[] = [];
    const skippedStops: string[] = [];
    for (const w of stopWaypoints) {
      const geo = await geocodeBest(w.address, originCoords);
      if (!geo) {
        return NextResponse.json(
          {
            error: `The map couldn't locate pick-up “${w.label}” (${w.address}). Check the postcode on their packing page.`,
          },
          { status: 404 },
        );
      }
      const coords = parseGeo(geo);
      const distanceFromHomeKm =
        Math.round(haversineKm(originCoords, coords) * 10) / 10;
      // Keep stops near the driver even if slightly off the straight corridor
      const nearOrigin = distanceFromHomeKm <= 40;
      if (
        !nearOrigin &&
        !pointInCorridor(coords, originCoords, destCoords, corridorSlackKm) &&
        distanceFromHomeKm > 100
      ) {
        skippedStops.push(
          `${w.label} (${distanceFromHomeKm} km off the ${fromTown || "home"}→parking route)`,
        );
        continue;
      }
      midPoints.push({
        id: w.id,
        label: w.label,
        address: w.address,
        geo,
        distanceFromHomeKm,
      });
    }

    midPoints.sort((a, b) => a.distanceFromHomeKm - b.distanceFromHomeKm);

    const orderedWaypoints: OrderedWaypoint[] = midPoints.map((m) => ({
      id: m.id,
      label: m.label,
      address: m.address,
      distanceFromHomeKm: m.distanceFromHomeKm,
    }));

    const destLabel = body.parkingName?.trim() || toTown || "Parking";
    const warnings = [originNote, ...skippedStops.map((s) => `Skipped pick-up ${s}`)].filter(
      Boolean,
    ) as string[];

    const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (googleKey) {
      // Prefer the resolved origin (may be from-town fallback) over raw candidates
      const originQuery =
        originNote && fromTown
          ? `${fromTown}, United Kingdom`
          : addressQueryCandidates(originRaw)[0] ?? originRaw;
      for (const dest of destQueries) {
        const points = [
          { query: originQuery, label: originPoint.label },
          ...midPoints.map((w) => ({
            query: addressQueryCandidates(w.address)[0] ?? w.address,
            label: w.label,
          })),
          { query: dest, label: destLabel },
        ];
        const g = await googleMultiLeg(points, googleKey, nightDrive);
        if (g && g.driveMinutes <= 210) {
          return NextResponse.json({
            ...g,
            litresEstimate: Math.round((g.distanceKm * 7) / 100 * 10) / 10,
            source: "google",
            destinationQuery: dest,
            nightDrive,
            waypointCount: midPoints.length,
            orderedWaypoints,
            note: [
              midPoints.length > 0
                ? `Pick-ups ordered nearest to home first. Multi-stop road time ~${g.driveMinutes} min across ${g.legs.length} legs. Stop dwell is separate.`
                : nightDrive
                  ? `Road distance overnight ~${g.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`
                  : `Road distance ~${g.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`,
              ...warnings,
            ]
              .filter(Boolean)
              .join(" "),
          });
        }
      }
    }

    let osrm = await osrmMultiLeg([
      { geo: originGeo, label: originPoint.label },
      ...midPoints.map((m) => ({ geo: m.geo, label: m.label })),
      { geo: destGeo, label: destLabel },
    ]);

    // Absurd multi-stop route (bad geocode) → direct home→parking + small stop pad
    if (osrm && osrm.driveMinutes > 210) {
      const tooLong = osrm.driveMinutes;
      const direct = await osrmMultiLeg([
        { geo: originGeo, label: originPoint.label },
        { geo: destGeo, label: destLabel },
      ]);
      if (direct && direct.driveMinutes < tooLong) {
        const pad = midPoints.length * 12;
        const driveMinutes = direct.driveMinutes + pad;
        const perStop = midPoints.length
          ? Math.max(1, Math.round(driveMinutes / (midPoints.length + 1)))
          : driveMinutes;
        const legs: LegOut[] = [];
        let remaining = driveMinutes;
        const labels = [
          originPoint.label,
          ...midPoints.map((m) => m.label),
          destLabel,
        ];
        for (let i = 0; i < labels.length - 1; i++) {
          const isLast = i === labels.length - 2;
          const minutes = isLast ? Math.max(1, remaining) : perStop;
          remaining -= minutes;
          legs.push({
            fromLabel: labels[i],
            toLabel: labels[i + 1],
            minutes,
            distanceKm:
              Math.round((direct.distanceKm / (labels.length - 1)) * 10) / 10,
          });
        }
        osrm = {
          driveMinutes,
          distanceKm: direct.distanceKm,
          legs,
          fromLabel: originPoint.label,
          toLabel: destLabel,
        };
        warnings.push(
          `Map route looked too long (${tooLong} min with detours) — used direct ${fromTown || "home"}→parking plus ${pad} min for pick-ups.`,
        );
      }
    }

    if (!osrm) {
      return NextResponse.json(
        { error: "Routing service unavailable. Set drive minutes manually." },
        { status: 502 },
      );
    }

    const litres = Math.round((osrm.distanceKm * 7) / 100 * 10) / 10;

    return NextResponse.json({
      ...osrm,
      litresEstimate: litres,
      source: "osrm",
      destinationQuery: usedQuery,
      nightDrive,
      waypointCount: midPoints.length,
      orderedWaypoints,
      note: [
        midPoints.length > 0
          ? `Pick-ups ordered nearest to home first. Multi-stop road time ~${osrm.driveMinutes} min across ${osrm.legs.length} legs. Stop dwell is separate.`
          : `Road distance ~${osrm.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`,
        ...warnings,
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch {
    return NextResponse.json({ error: "Drive estimate failed. Set minutes manually." }, { status: 500 });
  }
}
