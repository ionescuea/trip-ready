import { NextResponse } from "next/server";
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

  // Soft-normalize jammed postcodes (PL21QG → PL2 1QG)
  const spaced = raw
    .replace(/\s+/g, " ")
    .replace(/\b([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})\b/gi, "$1 $2")
    .trim();

  const noCountry = spaced
    .replace(/\bUnited Kingdom\b/gi, "")
    .replace(/\bUK\b/gi, "")
    .replace(/,\s*,+/g, ",")
    .replace(/^,\s*|,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const postcode = extractUkPostcode(spaced) || extractUkPostcode(raw);
  const candidates: string[] = [];

  // Prefer the full street address first. Bare postcode alone can snap to the
  // wrong town centroid and inflate multi-stop drive times overnight.
  if (noCountry) candidates.push(noCountry);
  if (noCountry && !/united kingdom/i.test(noCountry)) {
    candidates.push(`${noCountry}, United Kingdom`);
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
  if (postcode) {
    candidates.push(`${postcode}, United Kingdom`);
    candidates.push(postcode);
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

async function geocode(query: string): Promise<NominatimResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "gb");

  const res = await fetch(url, {
    headers: {
      "User-Agent": "TripReady/0.1 (local prototype; contact=local-dev)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = (await res.json()) as NominatimResult[];
  return data[0] ?? null;
}

async function geocodeBest(place: string): Promise<NominatimResult | null> {
  for (const q of addressQueryCandidates(place)) {
    const hit = await geocode(q);
    if (hit) return hit;
  }
  return null;
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

    const homeAddress = body.homeAddress?.trim();
    const fromTown = body.fromTown?.trim();
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

    // Geocode home + stops first so we can order nearest-to-home, then route.
    const originGeo = await geocodeBest(originRaw);
    if (!originGeo) {
      return NextResponse.json(
        {
          error: `Could not find “${originRaw}”. Try a fuller address or postcode.`,
        },
        { status: 404 },
      );
    }
    const originCoords = parseGeo(originGeo);

    const midPoints: {
      id?: string;
      label: string;
      address: string;
      geo: NominatimResult;
      distanceFromHomeKm: number;
    }[] = [];
    for (const w of stopWaypoints) {
      const geo = await geocodeBest(w.address);
      if (!geo) {
        return NextResponse.json(
          {
            error: `Could not find stop “${w.label}” at “${w.address}”. Try a fuller address or postcode.`,
          },
          { status: 404 },
        );
      }
      const distanceFromHomeKm =
        Math.round(haversineKm(originCoords, parseGeo(geo)) * 10) / 10;
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

    const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (googleKey) {
      const originCandidates = addressQueryCandidates(originRaw);
      for (const dest of destQueries) {
        for (const originQ of originCandidates) {
          const points = [
            { query: originQ, label: originPoint.label },
            ...midPoints.map((w) => ({
              query: addressQueryCandidates(w.address)[0] ?? w.address,
              label: w.label,
            })),
            { query: dest, label: destLabel },
          ];
          const g = await googleMultiLeg(points, googleKey, nightDrive);
          if (g) {
            return NextResponse.json({
              ...g,
              litresEstimate: Math.round((g.distanceKm * 7) / 100 * 10) / 10,
              source: "google",
              destinationQuery: dest,
              nightDrive,
              waypointCount: midPoints.length,
              orderedWaypoints,
              note:
                midPoints.length > 0
                  ? `Pick-ups ordered nearest to home first. Multi-stop road time ~${g.driveMinutes} min across ${g.legs.length} legs. Stop dwell is separate.`
                  : nightDrive
                    ? `Road distance overnight ~${g.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`
                    : `Road distance ~${g.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`,
            });
          }
        }
      }
    }

    let destGeo: NominatimResult | null = null;
    let usedQuery = destQueries[0];
    for (const q of destQueries) {
      destGeo = await geocode(q);
      if (destGeo) {
        usedQuery = q;
        break;
      }
    }
    if (!destGeo) {
      return NextResponse.json(
        {
          error: `Could not find “${toTown || destQueries[0]}”. Try a town, city, or airport name.`,
        },
        { status: 404 },
      );
    }

    const osrm = await osrmMultiLeg([
      { geo: originGeo, label: originPoint.label },
      ...midPoints.map((m) => ({ geo: m.geo, label: m.label })),
      { geo: destGeo, label: destLabel },
    ]);

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
      note:
        midPoints.length > 0
          ? `Pick-ups ordered nearest to home first. Multi-stop road time ~${osrm.driveMinutes} min across ${osrm.legs.length} legs. Stop dwell is separate.`
          : `Road distance ~${osrm.driveMinutes} min (rounded up). Traffic buffer is added in leave-by.`,
    });
  } catch {
    return NextResponse.json({ error: "Drive estimate failed. Set minutes manually." }, { status: 500 });
  }
}
