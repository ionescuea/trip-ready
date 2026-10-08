"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { findOwnerPerson, isEmailAccessMeta } from "@/lib/cloudMeta";
import { nameInitials } from "@/lib/names";

const PUBLIC_PATHS = ["/", "/join", "/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { trip, hydrated, status } = useTrip();
  const { ready, membershipReady, user, meta } = useCloud();
  const publicPath = isPublicPath(pathname);
  const emailAccess = isEmailAccessMeta(meta);
  const showHolidayListNav =
    Boolean(user && meta?.role !== "traveller") || Boolean(meta?.organiserEmail);
  const isTravellerSession = Boolean(
    meta?.role === "traveller" || (emailAccess && meta?.travellerEmail),
  );
  const hasTrip = Boolean(meta?.tripId && trip && status);
  const onHome = pathname === "/";

  useEffect(() => {
    if (!ready || !membershipReady) return;

    if (!user && !emailAccess && !publicPath) {
      router.replace("/");
      return;
    }

    if (user && !meta?.tripId && !isTravellerSession) {
      if (!onHome && pathname !== "/account") {
        router.replace("/");
      }
      return;
    }

    if (isTravellerSession && onHome) {
      router.replace("/hub");
    }
  }, [
    ready,
    membershipReady,
    user,
    emailAccess,
    meta?.tripId,
    isTravellerSession,
    publicPath,
    onHome,
    pathname,
    router,
  ]);

  if (!ready || !membershipReady || !hydrated) {
    return <main className="shell loading">Loading…</main>;
  }

  if (!user && !emailAccess) {
    return (
      <main className="shell">
        <div className="app-top">
          <Link href="/" className="brand-lockup" style={{ textDecoration: "none" }}>
            <div className="brand-mark" aria-hidden>
              T
            </div>
            <p className="brand-name">Trip Ready</p>
          </Link>
          <Link href="/" className="avatar" title="Sign in">
            ?
          </Link>
        </div>
        {children}
      </main>
    );
  }

  if (!hasTrip) {
    return (
      <main className="shell">
        <div className="app-top">
          <Link href="/" className="brand-lockup" style={{ textDecoration: "none" }}>
            <div className="brand-mark" aria-hidden>
              T
            </div>
            <p className="brand-name">Trip Ready</p>
          </Link>
          <Link href="/account" className="avatar" title="Account">
            {nameInitials(
              user?.email ?? meta?.organiserEmail ?? meta?.travellerEmail ?? "U",
            )}
          </Link>
        </div>
        {children}
      </main>
    );
  }

  const me =
    trip!.people.find((p) => p.id === meta?.personId) ??
    findOwnerPerson(trip!.people) ??
    trip!.people[0];

  const initials = nameInitials(
    me?.name || user?.email || meta?.organiserEmail || meta?.travellerEmail,
  );

  const tripsHref = showHolidayListNav ? "/" : "/hub";

  const nav = [
    {
      href: tripsHref,
      label: showHolidayListNav ? "Holidays" : "Home",
      match: (p: string) => (showHolidayListNav ? p === "/" : p === "/hub" || p === "/"),
      icon: "home" as const,
    },
    {
      href: "/bookings",
      label: "Bookings",
      match: (p: string) => p.startsWith("/bookings") || p.startsWith("/day-trips"),
      icon: "bookings" as const,
    },
    {
      href: "/leave-by",
      label: "Leave by",
      match: (p: string) => p.startsWith("/leave-by"),
      icon: "leave" as const,
    },
    {
      href: "/travellers",
      label: "Pack",
      match: (p: string) => p.startsWith("/travellers") || p.startsWith("/ready"),
      icon: "pack" as const,
    },
    {
      href: "/wallet",
      label: "Wallet",
      match: (p: string) => p.startsWith("/wallet"),
      icon: "wallet" as const,
    },
  ];

  return (
    <main className="shell">
      <div className="app-top">
        <Link
          href={showHolidayListNav ? "/" : "/hub"}
          className="brand-lockup"
          style={{ textDecoration: "none" }}
        >
          <div className="brand-mark" aria-hidden>
            T
          </div>
          <p className="brand-name">Trip Ready</p>
        </Link>
        <Link href="/account" className="avatar" title="Account">
          {initials}
        </Link>
      </div>

      {children}

      {/* Organiser holiday list: no bottom nav. Trip pages: full nav. */}
      {onHome && showHolidayListNav ? null : (
        <nav className="bottom-nav" aria-label="Primary">
          {nav.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={`nav-item ${item.match(pathname) ? "active" : ""}`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}

function NavIcon({
  name,
}: {
  name: "home" | "bookings" | "leave" | "pack" | "wallet";
}) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 10.5 12 3l9 7.5V21H14v-6H10v6H3z" />
      </svg>
    );
  }
  if (name === "bookings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 6h16v12H4z" />
        <path d="M8 6V4h8v2" />
      </svg>
    );
  }
  if (name === "leave") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l3.5 2" />
      </svg>
    );
  }
  if (name === "wallet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 7h18v12H3z" />
        <path d="M3 7V5h14" />
        <path d="M15 13h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
