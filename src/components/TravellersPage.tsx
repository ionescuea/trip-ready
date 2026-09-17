"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { personAddressLabel } from "@/lib/personAddress";
import { nameInitials } from "@/lib/names";
import { DOCUMENT_ROWS, LUGGAGE_ROWS } from "@/lib/types";

export function TravellersPage() {
  const { trip, addTraveller } = useTrip();
  const { canEditTrip, isTraveller, myPersonId } = usePermissions();
  if (!trip) return null;

  const people =
    isTraveller && myPersonId
      ? trip.people.filter((p) => p.id === myPersonId)
      : trip.people;

  return (
    <>
      <PageHeader title="Packing lists" />

      {isTraveller ? (
        <ViewOnlyBanner>
          This is your packing list. Tick documents and bags here — other trip pages are
          view-only.
        </ViewOnlyBanner>
      ) : null}

      {canEditTrip ? (
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={addTraveller}>
            Add traveller
          </button>
          <Link href="/leave-by" className="btn btn-ghost">
            Pick-up addresses
          </Link>
        </div>
      ) : null}

      {people.length === 0 ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            {isTraveller
              ? "Your traveller profile isn’t linked yet — open Account and pick who you are."
              : "No travellers yet. Add people, then open each packing list."}
          </p>
        </section>
      ) : (
        <nav className="menu-list">
          {people.map((p) => {
            const docsDone = DOCUMENT_ROWS.filter(
              (r) => trip.checklist[p.id]?.[r.key] === "done",
            ).length;
            const bagsDone = LUGGAGE_ROWS.filter(
              (r) => trip.luggage?.[p.id]?.[r.key] === "done",
            ).length;
            const hasAddress = Boolean(p.address?.trim());
            return (
              <Link key={p.id} href={`/travellers/${p.id}`} className="menu-link">
                <span className="avatar" style={{ width: "2.5rem", height: "2.5rem" }}>
                  {nameInitials(p.name)}
                </span>
                <span className="menu-copy">
                  <strong>{p.name}</strong>
                  <span>
                    Docs {docsDone}/{DOCUMENT_ROWS.length} · Bags {bagsDone}/
                    {LUGGAGE_ROWS.length}
                    {canEditTrip ? (
                      <>
                        {" · "}
                        {hasAddress ? "Pick-up set" : "No pick-up yet"}
                      </>
                    ) : null}
                  </span>
                  {canEditTrip && hasAddress ? (
                    <span className="menu-address">{personAddressLabel(p)}</span>
                  ) : null}
                </span>
                <span className="menu-chevron" aria-hidden>
                  ›
                </span>
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
