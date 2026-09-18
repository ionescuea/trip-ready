"use client";

import { BookingList } from "@/components/BookingList";
import { DropZone } from "@/components/DropZone";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { withParkingAsRouteStart } from "@/lib/parkingRouteStart";
import type { BookingDetails } from "@/lib/types";
import Link from "next/link";

export function BookingsPage() {
  const { trip, extracting, lastNotes, ingest, update } = useTrip();
  const { canEditTrip } = usePermissions();
  if (!trip) return null;

  return (
    <>
      <PageHeader title="Bookings" />

      {!canEditTrip ? (
        <ViewOnlyBanner>
          View only — only the trip owner can add or change bookings.
        </ViewOnlyBanner>
      ) : null}

      {canEditTrip ? (
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Flight, hotel and parking live here. Day trips are on{" "}
          <Link href="/day-trips">While there</Link>.
        </p>
      ) : null}

      {extracting ? (
        <div className="banner">
          <p>Extracting booking details…</p>
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
        {canEditTrip ? <DropZone onText={ingest} busy={extracting} /> : null}
        <BookingList
          bookings={trip.bookings}
          readOnly={!canEditTrip}
          onSetRouteStart={(bookingId, checked) =>
            update((t) => withParkingAsRouteStart(t, bookingId, checked))
          }
          onConfirm={(id) =>
            update((t) => ({
              ...t,
              bookings: t.bookings.map((b) =>
                b.id === id
                  ? {
                      ...b,
                      confirmed: true,
                      extracted: {
                        ...b.extracted,
                        status:
                          b.extracted.status === "unknown"
                            ? "confirmed"
                            : b.extracted.status,
                      },
                    }
                  : b,
              ),
            }))
          }
          onRemove={(id) =>
            update((t) => {
              const removed = t.bookings.find((b) => b.id === id);
              const bookings = t.bookings.filter((b) => b.id !== id);
              if (!removed) return t;
              if (removed.type === "parking") {
                return { ...t, bookings, parkingMinutes: undefined };
              }
              return { ...t, bookings };
            })
          }
          onChange={(id, patch, opts) =>
            update((t) => {
              let next = {
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
              };
              // If people/driver changed on a parking card already marked as start, re-link driver
              const booking = next.bookings.find((b) => b.id === id);
              if (
                booking?.type === "parking" &&
                booking.extracted.routeStart &&
                patch.people !== undefined
              ) {
                next = withParkingAsRouteStart(next, id, true);
              }
              return next;
            })
          }
        />
      </div>
    </>
  );
}
