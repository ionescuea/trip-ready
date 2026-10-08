"use client";

import Link from "next/link";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { resolveAirportQuery } from "@/lib/airports";
import {
  bookingsSectionStatus,
  leaveBySectionStatus,
  readinessSectionStatus,
  travellersSectionStatus,
} from "@/lib/sectionStatus";
import { experienceSectionStatus } from "@/lib/experiences";

function daysUntil(startDate?: string): string | null {
  if (!startDate?.trim()) return null;
  const m = startDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  let d: Date | null = null;
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    d = new Date(year, Number(m[2]) - 1, Number(m[1]));
  } else {
    const parsed = new Date(startDate);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return "Departed";
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day until departure";
  return `${diff} days until departure`;
}

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };
  switch (name) {
    case "flight":
      return (
        <svg {...common}>
          <path d="M2 12h20M12 2l3 10-3 10-3-10 3-10Z" />
        </svg>
      );
    case "leave":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6l4 2" />
        </svg>
      );
    case "ready":
      return (
        <svg {...common}>
          <path d="M9 12l2 2 4-4" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "pack":
      return (
        <svg {...common}>
          <path d="M6 7h12v14H6z" />
          <path d="M9 7V5h6v2" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M3 7h18v12H3z" />
          <path d="M3 7V5h14" />
          <path d="M15 13h4" />
        </svg>
      );
    case "daytrips":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
  }
}

export function HubPage() {
  const { trip, status, resetTrip, addTraveller, flags, cloudSyncing, cloudError } =
    useTrip();
  const { user, meta, ready, membershipReady } = useCloud();

  if (!ready || !membershipReady) return null;

  // Guests — blank app
  if (!user && !meta?.tripId) {
    return (
      <section className="panel welcome-panel">
        <div className="panel-head">
          <h2>Trip Ready</h2>
        </div>
        <p style={{ margin: "0 0 1rem" }}>
          Private trip planning. Organisers sign in with email and password.
          Travellers join with invite code + email.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Link href="/account" className="btn btn-primary">
            Organiser sign in
          </Link>
          <Link href="/join" className="btn btn-ghost">
            Join with code
          </Link>
        </div>
      </section>
    );
  }

  // Signed in / email access, no trip loaded yet
  if (!meta?.tripId || !trip || !status) {
    return (
      <section className="panel welcome-panel">
        <div className="panel-head">
          <h2>Welcome</h2>
        </div>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Finish setup on Account, or join with an invite code.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Link href="/account" className="btn btn-primary">
            Account
          </Link>
          <Link href="/join" className="btn btn-ghost">
            Join with code
          </Link>
        </div>
      </section>
    );
  }

  const from = trip.fromTown?.trim();
  const destination = trip.destination?.trim();
  const parking = trip.bookings.find((b) => b.type === "parking")?.extracted;
  const parkingName = parking?.name?.trim() || "";
  const flight = trip.bookings.find((b) => b.type === "flight")?.extracted;
  const airportRaw =
    flight?.departureAirport?.trim() ||
    trip.driveAirport?.trim() ||
    parking?.airport?.trim() ||
    "";
  const airportLabel = (resolveAirportQuery(airportRaw) || airportRaw)
    .replace(/,\s*UK$/i, "")
    .trim();

  const routeParts: string[] = [];
  const pushUnique = (label?: string) => {
    if (!label) return;
    if (routeParts.some((p) => p.toLowerCase() === label.toLowerCase())) return;
    routeParts.push(label);
  };

  pushUnique(from);
  pushUnique(parkingName);
  pushUnique(airportLabel);
  pushUnique(destination);

  const routeLabel = routeParts.join(" → ");
  const dateLabel = [trip.startDate, trip.endDate].filter(Boolean).join(" — ");
  const countdown = daysUntil(trip.startDate);

  const bookings = bookingsSectionStatus(trip);
  const leaveBy = leaveBySectionStatus(trip);
  const readyStatus = readinessSectionStatus(flags);
  const travellers = travellersSectionStatus(trip);
  const dayTrips = experienceSectionStatus(trip);

  const menu = [
    {
      href: "/bookings",
      title: "Bookings",
      detail: bookings.label,
      icon: "flight",
      tone: bookings.tone,
    },
    {
      href: "/day-trips",
      title: "While there",
      detail: dayTrips.label,
      icon: "daytrips",
      tone: dayTrips.tone,
    },
    {
      href: "/leave-by",
      title: "Leave home by",
      detail: leaveBy.label,
      icon: "leave",
      tone: leaveBy.tone,
    },
    {
      href: "/ready",
      title: "Group readiness",
      detail: readyStatus.label,
      icon: "ready",
      tone: readyStatus.tone,
    },
    {
      href: "/travellers",
      title: "Packing lists",
      detail: travellers.label,
      icon: "pack",
      tone: travellers.tone,
    },
    {
      href: "/wallet",
      title: "Wallet",
      detail:
        (trip.tickets?.length ?? 0) > 0
          ? `${trip.tickets!.length} pass${trip.tickets!.length === 1 ? "" : "es"}`
          : "Boarding passes",
      icon: "wallet",
      tone: (trip.tickets?.length ?? 0) > 0 ? ("green" as const) : ("yellow" as const),
    },
    {
      href: "/account",
      title: "Account",
      detail: meta.inviteCode ? `Code ${meta.inviteCode}` : "Invite & sign out",
      icon: "pack",
      tone: "yellow" as const,
    },
  ] as const;

  return (
    <>
      <section className="trip-hero">
        <p className="trip-hero-eyebrow">Your trip</p>
        <h1>{destination || trip.name}</h1>
        {routeLabel ? <p className="trip-hero-meta">{routeLabel}</p> : null}
        {dateLabel ? <p className="trip-hero-dates">{dateLabel}</p> : null}
        {!routeLabel && !dateLabel ? (
          <p className="trip-hero-meta">Open Bookings to add your confirmations</p>
        ) : null}
        <div className="trip-hero-row">
          {countdown ? <span className="countdown">{countdown}</span> : null}
          <div className={`status trip-hero-status ${status.className}`}>{status.text}</div>
        </div>
      </section>

      <nav className="menu-list" aria-label="Trip sections">
        {menu.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`menu-link menu-link-${item.tone}`}
          >
            <span className="hub-icon">
              <MenuIcon name={item.icon} />
            </span>
            <span className="menu-copy">
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </span>
            <span className={`menu-tone-pill tone-${item.tone}`}>
              {item.tone === "green" ? "Ready" : item.tone === "yellow" ? "Almost" : "Action"}
            </span>
            <span className="menu-chevron" aria-hidden>
              ›
            </span>
          </Link>
        ))}
      </nav>

      {meta.role === "owner" || !meta.role ? (
        <section className="hub-invite-banner" style={{ marginTop: "1.25rem" }}>
          <p>
            <strong>Invite travellers</strong> — code{" "}
            <span className="invite-code-inline">{meta.inviteCode}</span>
          </p>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Link href="/account" className="btn btn-primary">
              Copy invite
            </Link>
          </div>
        </section>
      ) : meta.role === "traveller" && meta.personId ? (
        <section className="hub-invite-banner" style={{ marginTop: "1.25rem" }}>
          <p>
            <strong>Your packing list</strong> — tick documents and bags; other pages are
            view-only.
          </p>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Link href={`/travellers/${meta.personId}`} className="btn btn-primary">
              Open my list
            </Link>
            <Link href="/wallet" className="btn btn-ghost">
              Wallet
            </Link>
            <Link href="/ready" className="btn btn-ghost">
              Group readiness
            </Link>
          </div>
        </section>
      ) : null}

      <div className="toolbar" style={{ marginTop: "1rem" }}>
        {meta.role !== "traveller" ? (
          <button type="button" className="btn btn-ghost" onClick={addTraveller}>
            Add traveller
          </button>
        ) : null}
        <Link href="/account" className="btn btn-ghost">
          Account
        </Link>
        {meta.role !== "traveller" ? (
          <button type="button" className="btn btn-ghost" onClick={resetTrip}>
            Clear trip
          </button>
        ) : null}
      </div>
      {cloudSyncing ? (
        <p className="muted" style={{ marginTop: "0.65rem" }}>
          Saving…
        </p>
      ) : !cloudError ? (
        <p className="muted" style={{ marginTop: "0.65rem" }}>
          Saved to your account.
        </p>
      ) : null}
      {cloudError ? (
        <p className="route-warn" style={{ marginTop: "0.65rem" }}>
          Cloud sync: {cloudError}
        </p>
      ) : null}
    </>
  );
}
