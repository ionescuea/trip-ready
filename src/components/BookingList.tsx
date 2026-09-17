"use client";

import { useEffect, useState, type MouseEvent } from "react";
import type { Booking, BookingDetails, BookingStatus } from "@/lib/types";
import { BOOKING_STATUS_OPTIONS } from "@/lib/types";
import { isAutoConfirmed } from "@/lib/bookingDetails";

type Props = {
  bookings: Booking[];
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (
    id: string,
    patch: Partial<BookingDetails>,
    opts?: { autoConfirm?: boolean; manual?: boolean },
  ) => void;
  onSetRouteStart: (bookingId: string, checked: boolean) => void;
  readOnly?: boolean;
};

/** Always show: parking → flight → hotel → other. Missing types are omitted. */
const TYPE_ORDER = ["parking", "flight", "hotel", "other"] as const;

function sortBookings(bookings: Booking[]): Booking[] {
  return [...bookings].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type as (typeof TYPE_ORDER)[number]);
    const bi = TYPE_ORDER.indexOf(b.type as (typeof TYPE_ORDER)[number]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <input
        value={value ?? ""}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function BookingCard({
  booking,
  routeStartChecked,
  onConfirm,
  onRemove,
  onChange,
  onSetRouteStart,
  readOnly,
}: {
  booking: Booking;
  routeStartChecked: boolean;
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: Props["onChange"];
  onSetRouteStart: Props["onSetRouteStart"];
  readOnly?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const d = booking.extracted;
  const isParking = booking.type === "parking";
  const needsRouteStart = isParking && !routeStartChecked;

  useEffect(() => {
    setDirty(false);
  }, [booking.id, booking.createdAt]);

  useEffect(() => {
    if (booking.confirmed) setDirty(false);
  }, [booking.confirmed]);

  function edit(patch: Partial<BookingDetails>) {
    if (readOnly) return;
    setDirty(true);
    onChange(booking.id, patch, { manual: true });
  }

  function handleRemove(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    const label = d.name?.trim() || booking.type;
    if (!window.confirm(`Remove this ${booking.type} booking?\n\n${label}`)) return;
    onRemove(booking.id);
  }

  function handleSave(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    if (needsRouteStart) {
      window.alert(
        "Tick “Trip starting point” first — the driver on this parking booking is where the drive begins.",
      );
      return;
    }
    setDirty(false);
    onConfirm(booking.id);
  }

  const showSave = !readOnly && (dirty || !booking.confirmed);

  return (
    <article
      className={`booking ${booking.confirmed && !dirty && !needsRouteStart ? "confirmed" : ""}`}
    >
      <header>
        <span className="tag">{booking.type}</span>
        <span className="muted">{booking.sourceName}</span>
        {dirty ? (
          <span className="pill warn">Unsaved edits</span>
        ) : needsRouteStart ? (
          <span className="pill warn">Set starting point</span>
        ) : !booking.confirmed ? (
          <span className="pill warn">Needs check</span>
        ) : (
          <span className="pill ok">Confirmed</span>
        )}
      </header>

      <div className="grid-fields">
        <Field label="Booking name" value={d.name} onChange={(v) => edit({ name: v })} readOnly={readOnly} />
        <Field label="Booking number" value={d.number} onChange={(v) => edit({ number: v })} readOnly={readOnly} />
        <Field label="Start date" value={d.startDate} onChange={(v) => edit({ startDate: v })} readOnly={readOnly} />
        <Field label="End date" value={d.endDate} onChange={(v) => edit({ endDate: v })} readOnly={readOnly} />
        <Field label="Start time" value={d.startTime} onChange={(v) => edit({ startTime: v })} readOnly={readOnly} />
        <Field label="End time" value={d.endTime} onChange={(v) => edit({ endTime: v })} readOnly={readOnly} />
        <label className="field compact">
          <span>Status</span>
          <select
            value={d.status}
            disabled={readOnly}
            onChange={(e) => {
              if (readOnly) return;
              const status = e.target.value as BookingStatus;
              setDirty(true);
              onChange(booking.id, { status }, {
                manual: true,
                autoConfirm: isAutoConfirmed(status),
              });
            }}
          >
            {BOOKING_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={isParking ? "People on booking / driver" : "People on booking"}
          value={d.people}
          onChange={(v) => edit({ people: v })}
          readOnly={readOnly}
        />
        {booking.type === "flight" ? (
          <Field
            label="Arrive early (minutes before departure)"
            value={d.arriveEarlyMinutes}
            onChange={(v) => edit({ arriveEarlyMinutes: v })}
            readOnly={readOnly}
          />
        ) : null}
        {isParking ? (
          <Field
            label="Transfer to terminal (minutes)"
            value={d.transferMinutes}
            onChange={(v) => edit({ transferMinutes: v })}
            readOnly={readOnly}
          />
        ) : null}
      </div>

      {isParking ? (
        <label
          className={`route-start-check${needsRouteStart ? " route-start-check-required" : ""}`}
        >
          <input
            type="checkbox"
            checked={routeStartChecked}
            disabled={readOnly || !d.people?.trim()}
            onChange={(e) => {
              if (readOnly) return;
              onSetRouteStart(booking.id, e.target.checked);
              setDirty(true);
            }}
          />
          <span>
            <strong>Trip starting point</strong> — required. The driver above is who leaves
            first; the route starts from their postcode (set on Leave home by).
          </span>
        </label>
      ) : null}

      <label className="field">
        <span>Other useful info</span>
        <textarea
          rows={3}
          value={d.usefulInfo ?? ""}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => edit({ usefulInfo: e.target.value })}
        />
      </label>

      <details className="raw-details">
        <summary>Show extracted text</summary>
        <pre className="raw">{booking.rawText.slice(0, 2500)}</pre>
      </details>

      {!readOnly ? (
        <div className="booking-actions">
          {showSave ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={needsRouteStart}
              onClick={handleSave}
            >
              {dirty ? "Save" : "Confirm"}
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={handleRemove}>
            Remove
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function BookingList({
  bookings,
  onConfirm,
  onRemove,
  onChange,
  onSetRouteStart,
  readOnly,
}: Props) {
  const ordered = sortBookings(bookings);

  if (ordered.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Bookings</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Bookings</h2>
      </div>
      <div className="booking-stack">
        {ordered.map((b) => (
          <BookingCard
            key={b.id}
            booking={b}
            routeStartChecked={b.type === "parking" && b.extracted.routeStart === true}
            onConfirm={onConfirm}
            onRemove={onRemove}
            onChange={onChange}
            onSetRouteStart={onSetRouteStart}
            readOnly={readOnly}
          />
        ))}
      </div>
    </section>
  );
}
