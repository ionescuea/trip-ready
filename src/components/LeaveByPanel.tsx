"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AddressField } from "@/components/AddressField";
import { usePermissions } from "@/hooks/usePermissions";
import { softNormalizeUkAddress } from "@/lib/addressFormat";
import { getTripAirportLabel } from "@/lib/airports";
import {
  driverFirstName,
  getDriverPerson,
  getDriverStartAddress,
  inferDriverPerson,
  isDriverSetupComplete,
  passengersForPickup,
} from "@/lib/driver";
import { formatDuration } from "@/lib/duration";
import {
  computeLeaveBy,
  formatFlowDayHint,
  formatWhen,
  formatWhenParts,
} from "@/lib/leaveBy";
import type { BookingDetails, DriveLeg, ExtraStop, Trip } from "@/lib/types";

type Props = {
  trip: Trip;
  readOnly?: boolean;
  onChangeDriver: (personId: string) => void;
  onChangeFromTown: (town: string) => void;
  onChangeToTown: (town: string) => void;
  onChangeHomeAddress: (homePostcode: string) => void;
  onChangePersonAddress: (personId: string, address: string) => void;
  onChangeDrive: (
    minutes: number,
    distanceKm?: number,
    legs?: DriveLeg[],
    orderedStops?: ExtraStop[],
  ) => void;
  onChangeParking: (minutes: number) => void;
  onChangeExtraStops: (stops: ExtraStop[]) => void;
};

function newStopId() {
  return `stop_${Math.random().toString(36).slice(2, 9)}`;
}

function resolveStopAddress(trip: Trip, stop: ExtraStop): string {
  if (stop.address?.trim()) return stop.address.trim();
  if (stop.personId) {
    const person = trip.people.find((p) => p.id === stop.personId);
    return person?.address?.trim() ?? "";
  }
  return "";
}

/** Reorder stops to match map order (nearest home first); keep unmapped at end. */
function reorderStopsByWaypointOrder(
  stops: ExtraStop[],
  ordered: { id?: string; address: string; label: string }[],
): ExtraStop[] {
  if (ordered.length === 0) return stops;
  const used = new Set<string>();
  const next: ExtraStop[] = [];

  for (const ow of ordered) {
    const match =
      (ow.id ? stops.find((s) => s.id === ow.id) : undefined) ??
      stops.find(
        (s) =>
          !used.has(s.id) &&
          (s.address?.trim() === ow.address ||
            s.label.trim() === ow.label),
      );
    if (match && !used.has(match.id)) {
      next.push(match);
      used.add(match.id);
    }
  }

  for (const s of stops) {
    if (!used.has(s.id)) next.push(s);
  }
  return next;
}

export function LeaveByPanel({
  trip,
  readOnly = false,
  onChangeDriver,
  onChangeFromTown,
  onChangeToTown,
  onChangeHomeAddress,
  onChangePersonAddress,
  onChangeDrive,
  onChangeParking,
  onChangeExtraStops,
}: Props) {
  const { myPersonId } = usePermissions();
  const plan = computeLeaveBy(trip);
  const [estimating, setEstimating] = useState(false);
  const [estimateMsg, setEstimateMsg] = useState<string | null>(null);
  const autoTried = useRef(false);
  const absurdRetried = useRef(false);
  const routeKeyRef = useRef("");

  const driver = getDriverPerson(trip);
  const driverReady = isDriverSetupComplete(trip);
  const pickupPeople = passengersForPickup(trip);

  const flowSteps = useMemo(() => {
    const steps: {
      key: string;
      time: string;
      name: string;
      dayHint?: string | null;
      personId?: string;
      mine?: boolean;
    }[] = [];
    const anchor = plan.leaveHomeAt;

    const leave = formatWhenParts(plan.leaveHomeAt);
    if (leave && plan.leaveHomeAt) {
      const leaveName = driverFirstName(trip);
      steps.push({
        key: "leave",
        time: leave.time,
        name: leaveName,
        dayHint: formatFlowDayHint(plan.leaveHomeAt, plan.parkingArriveBy),
        personId: driver?.id,
        mine: Boolean(driver?.id && myPersonId && driver.id === myPersonId),
      });
    }

    for (const p of plan.pickups) {
      // Never show the driver as a pick-up
      if (driver?.id && p.personId === driver.id) continue;
      const parts = formatWhenParts(p.arriveAt);
      if (!parts) continue;
      const name =
        p.personName?.trim().split(/\s+/)[0] ||
        p.label.replace(/^pick\s*up\s+/i, "").trim() ||
        "Pick-up";
      steps.push({
        key: p.id,
        time: parts.time,
        name,
        dayHint: formatFlowDayHint(p.arriveAt, anchor),
        personId: p.personId,
        mine: Boolean(p.personId && myPersonId && p.personId === myPersonId),
      });
    }

    const parking = formatWhenParts(plan.parkingArriveBy);
    if (parking && plan.parkingArriveBy) {
      steps.push({
        key: "parking",
        time: parking.time,
        name: "Parking",
        dayHint: formatFlowDayHint(plan.parkingArriveBy, anchor),
      });
    }

    return steps;
  }, [plan.leaveHomeAt, plan.pickups, plan.parkingArriveBy, myPersonId, trip, driver?.id]);

  const inferredTo = useMemo(() => {
    const flight = trip.bookings.find((b) => b.type === "flight");
    const parking = trip.bookings.find((b) => b.type === "parking");
    const dep = flight?.extracted.departureAirport;
    const park = parking?.extracted.airport;
    const parkName = parking?.extracted.name;
    if (parkName?.trim()) {
      return park?.trim()
        ? `${parkName.trim()} (${park.trim()})`
        : parkName.trim();
    }
    return getTripAirportLabel(undefined, dep, park);
  }, [trip.bookings]);

  const parking = useMemo(() => {
    const booking = trip.bookings.find((b) => b.type === "parking");
    return booking?.extracted as BookingDetails | undefined;
  }, [trip.bookings]);

  // Infer driver once; strip them from pick-up stops (they are the route start)
  useEffect(() => {
    if (readOnly) return;
    if (!trip.driverPersonId) {
      const inferred = inferDriverPerson(trip);
      if (inferred) onChangeDriver(inferred.id);
      return;
    }
    const withoutDriver = (trip.extraStops ?? []).filter(
      (s) => s.personId !== trip.driverPersonId,
    );
    if (withoutDriver.length !== (trip.extraStops ?? []).length) {
      onChangeExtraStops(withoutDriver);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.driverPersonId, trip.people, trip.bookings, readOnly]);

  // Passengers with addresses → pick-up stops (never the driver)
  useEffect(() => {
    if (readOnly) return;
    if (!trip.driverPersonId) return;
    const missing = pickupPeople.filter(
      (p) =>
        p.address?.trim() &&
        !(trip.extraStops ?? []).some((s) => s.personId === p.id),
    );
    if (missing.length === 0) return;
    onChangeExtraStops([
      ...(trip.extraStops ?? []),
      ...missing.map((person, i) => ({
        id: newStopId(),
        label: `Pick up ${person.name.trim().split(/\s+/)[0] || person.name}`,
        minutes: (trip.extraStops ?? []).length + i === 0 ? 0 : 5,
        personId: person.id,
        address: person.address ?? "",
      })),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.people, trip.extraStops, trip.driverPersonId, readOnly]);

  const toTownValue = trip.toTown?.trim() || inferredTo;
  const originReady = driverReady;

  const routeFingerprint = useMemo(() => {
    const stops = (trip.extraStops ?? [])
      .map((s) => `${s.id}:${resolveStopAddress(trip, s)}`)
      .join("|");
    return [
      // Bump when geocoder/routing changes so saved long legs re-estimate once
      "drv-v5",
      trip.homePostcode?.trim() ?? "",
      trip.fromTown?.trim() ?? "",
      toTownValue,
      parking?.name ?? "",
      parking?.airport ?? "",
      plan.nightDrive ? "night" : "day",
      stops,
    ].join("::");
  }, [
    trip.homePostcode,
    trip.fromTown,
    trip.extraStops,
    trip.people,
    toTownValue,
    parking?.name,
    parking?.airport,
    plan.nightDrive,
  ]);

  // Near parks (e.g. Oakwood): keep transfer at ~5 min; drop old 30–35 defaults
  useEffect(() => {
    if (readOnly) return;
    if (!parking?.name) return;
    const near = /oakwood|5\s*min/i.test(
      `${parking.name} ${parking.locationRelative ?? ""} ${parking.shuttleDetails ?? ""}`,
    );
    if (!near) return;
    if (trip.parkingMinutes == null || trip.parkingMinutes >= 25) {
      onChangeParking(5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parking?.name, parking?.locationRelative, parking?.shuttleDetails, readOnly]);

  async function estimateDrive() {
    if (readOnly) return;
    if (!driverReady) {
      setEstimateMsg("Choose the driver and their start postcode first.");
      return;
    }
    setEstimating(true);
    setEstimateMsg(null);
    try {
      const driverId = trip.driverPersonId || driver?.id;
      const waypoints = (trip.extraStops ?? [])
        .filter((s) => !driverId || s.personId !== driverId)
        .map((s) => ({
          id: s.id,
          label: s.label.trim() || "Stop",
          address: resolveStopAddress(trip, s),
        }))
        .filter((w) => w.address);

      const res = await fetch("/api/drive-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromTown: trip.fromTown,
          homeAddress: softNormalizeUkAddress(
            trip.homePostcode?.trim() || "",
          ) || undefined,
          toTown: toTownValue || undefined,
          parkingName: parking?.name,
          parkingAirport: parking?.airport || undefined,
          nightDrive: plan.nightDrive,
          waypoints,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        driveMinutes?: number;
        distanceKm?: number;
        litresEstimate?: number;
        fromLabel?: string;
        toLabel?: string;
        note?: string;
        source?: string;
        legs?: DriveLeg[];
        waypointCount?: number;
        orderedWaypoints?: {
          id?: string;
          label: string;
          address: string;
          distanceFromHomeKm: number;
        }[];
      };
      if (!res.ok || data.error) {
        setEstimateMsg(data.error || "Could not estimate drive.");
        return;
      }
      onChangeDrive(
        data.driveMinutes!,
        data.distanceKm,
        data.legs,
        data.orderedWaypoints?.length
          ? reorderStopsByWaypointOrder(
              trip.extraStops ?? [],
              data.orderedWaypoints,
            )
          : undefined,
      );
      const orderNote =
        data.orderedWaypoints && data.orderedWaypoints.length > 1
          ? `Nearest→furthest from home: ${data.orderedWaypoints
              .map((w) => `${w.label} (${w.distanceFromHomeKm} km)`)
              .join(" → ")}`
          : null;
      setEstimateMsg(
        [
          data.note,
          orderNote,
          `About ${data.distanceKm} km · ${formatDuration(data.driveMinutes!)}` +
            (data.litresEstimate ? ` · ~${data.litresEstimate} L petrol` : ""),
          data.fromLabel && data.toLabel ? `${data.fromLabel} → ${data.toLabel}` : null,
          data.waypointCount
            ? `${data.waypointCount} mapped stop${data.waypointCount === 1 ? "" : "s"}`
            : null,
          data.source === "osrm" && !data.note?.includes("Pick-ups")
            ? "OpenStreetMap estimate (add GOOGLE_MAPS_API_KEY for live Google traffic)."
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch {
      setEstimateMsg("Estimate failed — set drive minutes manually.");
    } finally {
      setEstimating(false);
    }
  }

  useEffect(() => {
    if (readOnly) return;
    const start = trip.homePostcode?.trim() || "";
    // Don't hammer the map while the address is still being typed / jammed
    const startLooksReady =
      /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(start) ||
      (start.length >= 12 && /\s/.test(start));
    if (!startLooksReady) return;

    const routeChanged = routeKeyRef.current !== routeFingerprint;
    if (routeChanged) absurdRetried.current = false;
    const maxLeg = Math.max(0, ...(trip.driveLegs ?? []).map((l) => l.minutes || 0));
    // Inflated totals / single runaway leg — force a fresh map pass
    const absurdDrive =
      ((typeof trip.driveMinutes === "number" && trip.driveMinutes > 210) ||
        maxLeg > 150) &&
      !absurdRetried.current;
    const needsEstimate =
      originReady &&
      Boolean(toTownValue) &&
      (trip.driveMinutes == null ||
        trip.driveMinutes <= 0 ||
        absurdDrive ||
        routeChanged);

    if (!needsEstimate || estimating) return;
    if (!routeChanged && !absurdDrive && autoTried.current) return;

    const t = setTimeout(() => {
      autoTried.current = true;
      if (absurdDrive) absurdRetried.current = true;
      routeKeyRef.current = routeFingerprint;
      void estimateDrive();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFingerprint, originReady, toTownValue, plan.nightDrive, readOnly, trip.homePostcode]);

  const mappedStops = useMemo(
    () =>
      (trip.extraStops ?? [])
        .map((s) => ({
          id: s.id,
          label: s.label.trim() || "Stop",
          address: resolveStopAddress(trip, s),
          dwell: s.minutes,
        }))
        .filter((s) => s.address),
    [trip.extraStops, trip.people],
  );
  const mappedWaypointCount = mappedStops.length;
  const unmappedStops = useMemo(
    () =>
      (trip.extraStops ?? []).filter((s) => !resolveStopAddress(trip, s)),
    [trip.extraStops, trip.people],
  );
  const expectedLegCount = mappedWaypointCount + 1;
  const actualLegCount = trip.driveLegs?.length ?? 0;
  const driveIncludesPickups =
    actualLegCount > 1 && mappedWaypointCount > 0;
  const routeMissingPickups =
    mappedWaypointCount > 0 && actualLegCount > 0 && actualLegCount < expectedLegCount;

  const routeLabels = useMemo(() => {
    const home =
      trip.homePostcode?.trim() ||
      trip.fromTown?.trim() ||
      "Home";
    const end =
      parking?.name?.trim() ||
      toTownValue ||
      "Parking";
    return [
      home.split(",")[0]?.trim() || "Home",
      ...mappedStops.map((s) => s.label),
      end.split(",")[0]?.trim() || "Parking",
    ];
  }, [trip.homePostcode, trip.fromTown, parking?.name, toTownValue, mappedStops]);

  function patchStop(id: string, patch: Partial<ExtraStop>) {
    onChangeExtraStops(
      (trip.extraStops ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }

  function addPickupStop() {
    const used = new Set(
      (trip.extraStops ?? []).map((s) => s.personId).filter(Boolean),
    );
    const person =
      pickupPeople.find((p) => p.address?.trim() && !used.has(p.id)) ??
      pickupPeople.find((p) => !used.has(p.id));
    if (!person) return;
    onChangeExtraStops([
      ...(trip.extraStops ?? []),
      {
        id: newStopId(),
        label: `Pick up ${person.name.split(/\s+/)[0]}`,
        minutes: (trip.extraStops ?? []).filter((s) =>
          Boolean(s.address?.trim() || s.personId),
        ).length === 0
          ? 0
          : 5,
        personId: person.id,
        address: person.address ?? "",
      },
    ]);
  }

  return (
    <section className="panel accent">
      <div className="leave-hero">
        {flowSteps.length > 0 ? (
          <div className="leave-flow" aria-label="Leave-home timeline">
            {flowSteps.map((step, i) => (
              <div key={step.key} className="leave-flow-pair">
                {i > 0 ? (
                  <span className="leave-flow-arrow" aria-hidden>
                    →
                  </span>
                ) : null}
                <div
                  className={`leave-flow-step${step.mine ? " leave-flow-mine" : ""}`}
                >
                  <span className="leave-flow-time">{step.time}</span>
                  {step.dayHint ? (
                    <span className="leave-flow-day">{step.dayHint}</span>
                  ) : null}
                  <span className="leave-flow-name">{step.name}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="leave-time">—</p>
        )}
      </div>

      <ol className="milestone-grid">
        <li className="milestone milestone-parking">
          <span className="milestone-label">At parking</span>
          {(() => {
            const parts = formatWhenParts(plan.parkingArriveBy);
            return parts ? (
              <strong className="milestone-when">
                <span className="milestone-clock">{parts.time}</span>
                <span className="milestone-date">{parts.date}</span>
              </strong>
            ) : (
              <strong className="milestone-time">—</strong>
            );
          })()}
          {plan.parkingToAirportWindowMinutes > 0 ? (
            <span className="milestone-note">
              Not earlier, not later · {plan.parkingToAirportWindowMinutes} min buffer
            </span>
          ) : null}
        </li>
        <li className="milestone milestone-airport">
          <span className="milestone-label">At airport</span>
          {(() => {
            const parts = formatWhenParts(plan.airportArriveBy);
            return parts ? (
              <strong className="milestone-when">
                <span className="milestone-clock">{parts.time}</span>
                <span className="milestone-date">{parts.date}</span>
              </strong>
            ) : (
              <strong className="milestone-time">—</strong>
            );
          })()}
          <span className="milestone-note">
            {plan.arriveEarlySource === "booking" ? "From booking" : "Recommended"}
          </span>
        </li>
        <li className="milestone milestone-flight">
          <span className="milestone-label">Flight</span>
          <strong className="milestone-time">{plan.flightDepartureLabel || "—"}</strong>
          <span className="milestone-note">Gate ~ {formatWhen(plan.gateCloseAt)}</span>
        </li>
      </ol>

      <section className="driver-setup">
        <div className="panel-head" style={{ padding: 0, marginBottom: "0.65rem" }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Driver & start</h2>
        </div>
        <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
          Required — the route starts at the driver’s postcode. They are not a pick-up.
        </p>
        <label className="field">
          <span>Driver</span>
          <select
            value={trip.driverPersonId || driver?.id || ""}
            disabled={readOnly || trip.people.length === 0}
            onChange={(e) => {
              if (e.target.value) onChangeDriver(e.target.value);
            }}
          >
            <option value="" disabled>
              Select who drives
            </option>
            {trip.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <AddressField
          label="Start address / postcode (where the driver leaves)"
          value={getDriverStartAddress(trip)}
          onChange={onChangeHomeAddress}
        />
      </section>

      <label className="field">
        <span>Travelling from (town / city)</span>
        <input
          type="text"
          value={trip.fromTown ?? ""}
          placeholder="Any town or city"
          onChange={(e) => onChangeFromTown(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Travelling to (town / city)</span>
        <input
          type="text"
          value={trip.toTown ?? ""}
          placeholder={inferredTo || "Any town, city, or airport area"}
          onChange={(e) => onChangeToTown(e.target.value)}
        />
      </label>

      {parking ? (
        <div className="parking-card">
          <strong>Parking → airport transfer</strong>
          <p>
            {parking.name || "Car park"}
            {parking.airport ? ` at ${parking.airport}` : ""}
          </p>
          {parking.locationRelative ? <p>{parking.locationRelative}</p> : null}
          {parking.terminal ? <p>Terminal: {parking.terminal}</p> : null}
          {parking.shuttleDetails || parking.shuttleIncluded ? (
            <p>{parking.shuttleDetails || parking.shuttleIncluded}</p>
          ) : null}
        </div>
      ) : null}

      <div className="row-2">
        <label className="field">
          <span>Drive (minutes)</span>
          <input
            type="number"
            min={5}
            max={400}
            placeholder="Estimate below"
            value={trip.driveMinutes ?? ""}
            onChange={(e) => onChangeDrive(Number(e.target.value) || 0)}
          />
        </label>
        <label className="field">
          <span>Park + transfer (minutes)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={trip.parkingMinutes ?? plan.transferMinutes}
            onChange={(e) => onChangeParking(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      {pickupPeople.length > 0 ? (
        <section className="pickup-people">
          <div className="panel-head" style={{ padding: 0, marginBottom: "0.65rem" }}>
            <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Pick-up addresses</h2>
          </div>
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            Other travellers only — collected after the driver leaves.
          </p>
          <div className="people-edit">
            {pickupPeople.map((p) => (
              <div key={p.id} className="person-edit-block">
                <p className="pickup-person-name">{p.name}</p>
                <AddressField
                  label="Pick-up address / postcode"
                  value={p.address ?? ""}
                  onChange={(address) => onChangePersonAddress(p.id, address)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="btn btn-primary"
        disabled={estimating || !originReady || !toTownValue}
        onClick={() => {
          routeKeyRef.current = routeFingerprint;
          void estimateDrive();
        }}
      >
        {estimating ? "Estimating…" : "Estimate drive on map"}
      </button>
      {estimateMsg ? <p className="estimate-msg">{estimateMsg}</p> : null}

      <div className="drive-legs-block">
        <p className="drive-legs-title">Mapped drive</p>
        <p className="route-plan">
          {routeLabels.map((label, i) => (
            <span key={`${label}-${i}`}>
              {i > 0 ? <span className="route-plan-arrow"> → </span> : null}
              <span className={i > 0 && i < routeLabels.length - 1 ? "route-plan-stop" : undefined}>
                {label}
              </span>
            </span>
          ))}
        </p>

        {driveIncludesPickups ? (
          <ol className="drive-legs">
            {trip.driveLegs!.map((leg, i) => (
              <li key={`${leg.fromLabel}-${leg.toLabel}-${i}`}>
                <span>
                  {leg.fromLabel} → {leg.toLabel}
                </span>
                <strong>{formatDuration(leg.minutes)}</strong>
              </li>
            ))}
          </ol>
        ) : (trip.driveLegs?.length ?? 0) > 0 ? (
          <ol className="drive-legs">
            {trip.driveLegs!.map((leg, i) => (
              <li key={`${leg.fromLabel}-${leg.toLabel}-${i}`}>
                <span>
                  {leg.fromLabel} → {leg.toLabel}
                </span>
                <strong>{formatDuration(leg.minutes)}</strong>
              </li>
            ))}
          </ol>
        ) : null}

        {mappedStops.length > 0 ? (
          <ul className="pickup-dwell-list">
            {mappedStops.map((s) => (
              <li key={s.id}>
                <span>{s.label}</span>
                <strong>{formatDuration(s.dwell)}</strong>
              </li>
            ))}
          </ul>
        ) : null}

        {routeMissingPickups ? (
          <p className="route-warn">
            Re-estimate the drive to include pick-up travel time.
          </p>
        ) : null}
      </div>

      {unmappedStops.length > 0 ? (
        <p className="route-warn">
          {unmappedStops.length === 1
            ? `Add an address for “${unmappedStops[0].label || "stop"}”.`
            : `Add addresses for ${unmappedStops.length} stops.`}
        </p>
      ) : null}

      <div className="extra-stops">
        <div className="extra-stops-head">
          <div>
            <strong>Extra stops</strong>
          </div>
          <div className="extra-stops-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                onChangeExtraStops([
                  ...(trip.extraStops ?? []),
                  { id: newStopId(), label: "Petrol", minutes: 10, address: "" },
                ])
              }
            >
              Add petrol
            </button>
            {trip.people.some((p) => p.name.trim()) ? (
              <button type="button" className="btn btn-ghost" onClick={addPickupStop}>
                Pick up traveller
              </button>
            ) : null}
          </div>
        </div>
        {(trip.extraStops ?? []).length === 0 ? null : (
          <ul className="extra-stop-list">
            {(trip.extraStops ?? []).map((stop) => {
              const mappedAddress = resolveStopAddress(trip, stop);
              return (
              <li key={stop.id} className="extra-stop-card">
                <div className="extra-stop-row">
                  <label className="field compact">
                    <span>What</span>
                    <input
                      type="text"
                      value={stop.label}
                      placeholder="e.g. Petrol"
                      onChange={(e) => patchStop(stop.id, { label: e.target.value })}
                    />
                  </label>
                  <label className="field compact">
                    <span>Time at stop</span>
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={stop.minutes || ""}
                      onChange={(e) =>
                        patchStop(stop.id, {
                          minutes: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost extra-stop-remove"
                    aria-label={`Remove ${stop.label || "stop"}`}
                    onClick={() =>
                      onChangeExtraStops(
                        (trip.extraStops ?? []).filter((s) => s.id !== stop.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                <AddressField
                  label="Address / postcode"
                  className="compact"
                  value={
                    stop.personId && !stop.address?.trim()
                      ? mappedAddress
                      : (stop.address ?? "")
                  }
                  onChange={(address) =>
                    patchStop(stop.id, {
                      address,
                    })
                  }
                />
                {pickupPeople.length > 0 ? (
                  <label className="field compact">
                    <span>Or pick up traveller</span>
                    <select
                      value={stop.personId ?? ""}
                      onChange={(e) => {
                        const personId = e.target.value || undefined;
                        const person = pickupPeople.find((p) => p.id === personId);
                        patchStop(stop.id, {
                          personId,
                          address: person?.address ?? "",
                          label: person
                            ? `Pick up ${person.name.split(/\s+/)[0]}`
                            : stop.label,
                          minutes: stop.minutes || 5,
                        });
                      }}
                    >
                      <option value="">Not a pick-up</option>
                      {pickupPeople.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.address?.trim() ? "" : " (add address above)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <details className="leave-breakdown">
        <summary>How this was calculated</summary>
        <ol className="timeline">
          {plan.steps.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <strong>{formatDuration(step.minutes)}</strong>
            </li>
          ))}
        </ol>
        <p className="muted">
          Total before departure: {formatDuration(plan.totalMinutesBeforeDeparture)}.
        </p>
        {plan.notes.length > 0 ? (
          <ul className="notes">
            {plan.notes.slice(0, 5).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
