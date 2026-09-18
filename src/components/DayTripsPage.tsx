"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { DropZone } from "@/components/DropZone";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import {
  isExperiencePast,
  sortedExperiences,
} from "@/lib/experiences";
import { isAutoConfirmed } from "@/lib/bookingDetails";
import type { Booking, BookingDetails, BookingStatus } from "@/lib/types";
import { BOOKING_STATUS_OPTIONS } from "@/lib/types";

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

function ExperienceCard({
  booking,
  past,
  readOnly,
  onConfirm,
  onRemove,
  onChange,
}: {
  booking: Booking;
  past: boolean;
  readOnly?: boolean;
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (
    id: string,
    patch: Partial<BookingDetails>,
    opts?: { autoConfirm?: boolean; manual?: boolean },
  ) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const d = booking.extracted;

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
    const label = d.name?.trim() || "day trip";
    if (!window.confirm(`Remove this day trip?\n\n${label}`)) return;
    onRemove(booking.id);
  }

  function handleSave(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    setDirty(false);
    onConfirm(booking.id);
  }

  const showSave = !readOnly && (dirty || !booking.confirmed);

  return (
    <article
      className={`booking booking-experience${past ? " booking-experience-past" : ""}${booking.confirmed && !dirty ? " confirmed" : ""}`}
    >
      <header>
        <span className="tag">day trip</span>
        {past ? <span className="pill">Done</span> : null}
        <span className="muted">{booking.sourceName}</span>
        {dirty ? (
          <span className="pill warn">Unsaved edits</span>
        ) : !booking.confirmed ? (
          <span className="pill warn">Needs check</span>
        ) : !past ? (
          <span className="pill ok">Confirmed</span>
        ) : null}
      </header>

      <div className="grid-fields">
        <Field
          label="Tour / experience"
          value={d.name}
          onChange={(v) => edit({ name: v })}
          readOnly={readOnly}
        />
        <Field
          label="Date"
          value={d.startDate}
          onChange={(v) => edit({ startDate: v })}
          readOnly={readOnly}
        />
        <Field
          label="Meet / start time"
          value={d.startTime}
          onChange={(v) => edit({ startTime: v })}
          readOnly={readOnly}
        />
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
          label="Tickets / who"
          value={d.people}
          onChange={(v) => edit({ people: v })}
          readOnly={readOnly}
        />
        <Field
          label="Meeting point"
          value={d.locationRelative}
          onChange={(v) => edit({ locationRelative: v })}
          readOnly={readOnly}
        />
      </div>

      <label className="field">
        <span>What to bring / notes</span>
        <textarea
          rows={4}
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
            <button type="button" className="btn btn-primary" onClick={handleSave}>
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

export function DayTripsPage() {
  const { trip, extracting, lastNotes, ingest, update } = useTrip();
  const { canEditTrip } = usePermissions();
  if (!trip) return null;

  const list = sortedExperiences(trip);
  const upcoming = list.filter((b) => !isExperiencePast(b));
  const past = list.filter((b) => isExperiencePast(b));

  function patchBooking(
    id: string,
    patch: Partial<BookingDetails>,
    opts?: { autoConfirm?: boolean; manual?: boolean },
  ) {
    update((t) => ({
      ...t,
      bookings: t.bookings.map((b) => {
        if (b.id !== id) return b;
        const extracted: BookingDetails = { ...b.extracted, ...patch };
        if (opts?.autoConfirm === true) {
          return { ...b, extracted, confirmed: true };
        }
        if (opts?.manual || opts?.autoConfirm === false) {
          return { ...b, extracted, confirmed: false };
        }
        return { ...b, extracted };
      }),
    }));
  }

  return (
    <>
      <PageHeader title="While there" />

      {!canEditTrip ? (
        <ViewOnlyBanner>
          View only — only the trip owner can add or change day trips.
        </ViewOnlyBanner>
      ) : null}

      <p className="muted" style={{ margin: "0 0 1rem" }}>
        Tours and activities once you’re away — separate from flight, hotel and parking
        on <Link href="/bookings">Bookings</Link>.
      </p>

      {extracting ? (
        <div className="banner">
          <p>Extracting day trip details…</p>
        </div>
      ) : null}

      {lastNotes.length > 0 && canEditTrip ? (
        <div className="banner">
          {lastNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}

      <div className="col">
        {canEditTrip ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Add a day trip</h2>
            </div>
            <p className="muted" style={{ margin: "0 0 0.75rem" }}>
              Paste a TUI / Musement confirmation email (Acropolis, cruise, Meteora, food
              tour…).
            </p>
            <DropZone onText={ingest} busy={extracting} />
          </section>
        ) : null}

        {list.length === 0 ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Your week</h2>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              No day trips yet. Paste a confirmation above and they’ll line up by date.
            </p>
          </section>
        ) : (
          <>
            <section className="panel">
              <div className="panel-head">
                <h2>Coming up</h2>
              </div>
              {upcoming.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  All planned day trips are done — past ones stay below for reference.
                </p>
              ) : (
                <>
                  <ol className="day-trips-timeline" aria-label="Upcoming day trips">
                    {upcoming.map((b) => {
                      const d = b.extracted;
                      return (
                        <li key={`tl-${b.id}`}>
                          <span className="day-trips-when">
                            {[d.startDate, d.startTime].filter(Boolean).join(" · ") ||
                              "Date TBC"}
                          </span>
                          <span className="day-trips-name">{d.name || "Experience"}</span>
                          {d.locationRelative ? (
                            <span className="day-trips-where">{d.locationRelative}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="booking-stack" style={{ marginTop: "1rem" }}>
                    {upcoming.map((b) => (
                      <ExperienceCard
                        key={b.id}
                        booking={b}
                        past={false}
                        readOnly={!canEditTrip}
                        onConfirm={(id) =>
                          update((t) => ({
                            ...t,
                            bookings: t.bookings.map((x) =>
                              x.id === id
                                ? {
                                    ...x,
                                    confirmed: true,
                                    extracted: {
                                      ...x.extracted,
                                      status:
                                        x.extracted.status === "unknown"
                                          ? "confirmed"
                                          : x.extracted.status,
                                    },
                                  }
                                : x,
                            ),
                          }))
                        }
                        onRemove={(id) =>
                          update((t) => ({
                            ...t,
                            bookings: t.bookings.filter((x) => x.id !== id),
                          }))
                        }
                        onChange={patchBooking}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>

            {past.length > 0 ? (
              <section className="panel day-trips-past-panel">
                <div className="panel-head">
                  <h2>Already done</h2>
                </div>
                <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                  Kept for reference — faded so the week ahead stays obvious.
                </p>
                <ol
                  className="day-trips-timeline day-trips-timeline-past"
                  aria-label="Past day trips"
                >
                  {past.map((b) => {
                    const d = b.extracted;
                    return (
                      <li key={`past-tl-${b.id}`}>
                        <span className="day-trips-when">
                          {[d.startDate, d.startTime].filter(Boolean).join(" · ") ||
                            "Date TBC"}
                        </span>
                        <span className="day-trips-name">{d.name || "Experience"}</span>
                        {d.locationRelative ? (
                          <span className="day-trips-where">{d.locationRelative}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                <div className="booking-stack" style={{ marginTop: "1rem" }}>
                  {past.map((b) => (
                    <ExperienceCard
                      key={b.id}
                      booking={b}
                      past
                      readOnly={!canEditTrip}
                      onConfirm={(id) =>
                        update((t) => ({
                          ...t,
                          bookings: t.bookings.map((x) =>
                            x.id === id
                              ? {
                                  ...x,
                                  confirmed: true,
                                  extracted: {
                                    ...x.extracted,
                                    status:
                                      x.extracted.status === "unknown"
                                        ? "confirmed"
                                        : x.extracted.status,
                                  },
                                }
                              : x,
                          ),
                        }))
                      }
                      onRemove={(id) =>
                        update((t) => ({
                          ...t,
                          bookings: t.bookings.filter((x) => x.id !== id),
                        }))
                      }
                      onChange={patchBooking}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
