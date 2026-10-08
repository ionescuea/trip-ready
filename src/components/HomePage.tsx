"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { findOwnerPerson, isEmailAccessMeta, withOwnerFullName } from "@/lib/cloudMeta";
import { formatAuthError } from "@/lib/authErrors";
import { createBlankTrip } from "@/lib/seed";
import { loadTrip } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import {
  claimOrganiserByCode,
  createCloudTrip,
  type OwnerTripSummary,
} from "@/lib/tripCloud";

type AuthMode = "signin" | "signup";

function tripTitle(t: OwnerTripSummary) {
  return t.destination.trim() || t.name.trim() || "Untitled trip";
}

function tripDates(t: OwnerTripSummary) {
  const a = t.startDate.trim();
  const b = t.endDate.trim();
  if (a && b) return `${a} – ${b}`;
  if (a) return a;
  if (b) return b;
  return "Dates not set";
}

export function HomePage() {
  const router = useRouter();
  const {
    configured,
    ready,
    membershipReady,
    user,
    meta,
    ownerTrips,
    selectTrip,
    refreshOwnerTrips,
    signUpWithPassword,
    signInWithPassword,
  } = useCloud();
  const { replaceTrip } = useTrip();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adoptCode, setAdoptCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emailAccess = isEmailAccessMeta(meta);

  // Travellers / legacy email sessions go straight into their trip
  useEffect(() => {
    if (!ready || !membershipReady) return;
    if (emailAccess && meta?.tripId) {
      router.replace("/hub");
    }
  }, [ready, membershipReady, emailAccess, meta?.tripId, router]);

  async function handleAuth() {
    setBusy(true);
    setMsg(null);
    const res =
      mode === "signup"
        ? await signUpWithPassword(email, password)
        : await signInWithPassword(email, password);
    setBusy(false);
    if (res.error) {
      setMsg(formatAuthError(res.error));
      return;
    }
    setPassword("");
    setMsg(mode === "signup" ? "Account created." : "Signed in.");
  }

  function seedTripLocal() {
    try {
      const local = loadTrip();
      if (local) return withOwnerFullName(local);
    } catch {
      /* ignore */
    }
    return createBlankTrip();
  }

  async function startNewTrip() {
    if (!user) return;
    setBusy(true);
    setMsg(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setMsg("Supabase is not configured.");
      return;
    }
    const seed = {
      ...seedTripLocal(),
      organiserEmail: user.email?.toLowerCase(),
    };
    const owner = findOwnerPerson(seed.people);
    const created = await createCloudTrip(client, seed, owner?.name || user.email || "Owner");
    if (created.error || !created.tripId) {
      setBusy(false);
      setMsg(formatAuthError(created.error) || "Could not create trip.");
      return;
    }
    await refreshOwnerTrips();
    selectTrip({
      tripId: created.tripId,
      inviteCode: created.inviteCode,
      personId: owner?.id,
      name: seed.name,
      destination: seed.destination,
      startDate: seed.startDate,
      endDate: seed.endDate,
      updatedAt: seed.updatedAt,
    });
    replaceTrip(seed);
    setBusy(false);
    router.push("/hub");
  }

  async function linkExistingTrip() {
    if (!user) return;
    const code = adoptCode.trim().toUpperCase();
    if (code.length < 4) {
      setMsg("Enter the invite code for your existing trip.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setMsg("Supabase is not configured.");
      return;
    }
    const res = await claimOrganiserByCode(client, code);
    if (res.error || !res.tripId || !res.trip) {
      setBusy(false);
      setMsg(formatAuthError(res.error) || "Could not open that trip.");
      return;
    }
    const owner = findOwnerPerson(res.trip.people);
    await refreshOwnerTrips();
    selectTrip({
      tripId: res.tripId,
      inviteCode: res.inviteCode,
      personId: owner?.id,
      name: res.trip.name,
      destination: res.trip.destination,
      startDate: res.trip.startDate,
      endDate: res.trip.endDate,
      updatedAt: res.trip.updatedAt,
    });
    replaceTrip(res.trip);
    setBusy(false);
    setMsg("Trip linked to your account.");
    router.push("/hub");
  }

  function openTrip(trip: OwnerTripSummary) {
    selectTrip(trip);
    router.push("/hub");
  }

  if (!ready || !membershipReady) {
    return (
      <section className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Loading…
        </p>
      </section>
    );
  }

  if (!configured) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Cloud not configured</h2>
          <p>
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
            .env.local, then restart.
          </p>
        </div>
      </section>
    );
  }

  if (emailAccess) {
    return (
      <section className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Opening your trip…
        </p>
      </section>
    );
  }

  // —— Organiser hub: list of holidays ——
  if (user) {
    return (
      <>
        <section className="home-hero">
          <p className="home-hero-eyebrow">Your holidays</p>
          <h1>Trip Ready</h1>
          <p className="home-hero-meta">
            Signed in as <strong>{user.email}</strong>
          </p>
        </section>

        {ownerTrips.length === 0 ? (
          <section className="panel">
            <div className="panel-head">
              <h2>No trips yet</h2>
              <p>Start a new holiday, or link one you already organised with an invite code.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void startNewTrip()}
            >
              {busy ? "Creating…" : "Start a new trip"}
            </button>
            <details style={{ marginTop: "1.25rem" }}>
              <summary className="muted">Link existing trip with invite code</summary>
              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>Invite code</span>
                <input
                  value={adoptCode}
                  placeholder="e.g. H34XFE"
                  autoCapitalize="characters"
                  onChange={(e) =>
                    setAdoptCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || adoptCode.trim().length < 4}
                onClick={() => void linkExistingTrip()}
              >
                Link trip
              </button>
            </details>
          </section>
        ) : (
          <>
            <div className="holiday-list" role="list">
              {ownerTrips.map((trip) => {
                const active = meta?.tripId === trip.tripId;
                return (
                  <button
                    key={trip.tripId}
                    type="button"
                    role="listitem"
                    className={`holiday-card${active ? " active" : ""}`}
                    onClick={() => openTrip(trip)}
                  >
                    <span className="holiday-card-label">Holiday</span>
                    <strong className="holiday-card-title">{tripTitle(trip)}</strong>
                    <span className="holiday-card-meta">{tripDates(trip)}</span>
                    <span className="holiday-card-code">Code {trip.inviteCode}</span>
                    <span className="holiday-card-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="toolbar" style={{ marginTop: "1.25rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void startNewTrip()}
              >
                {busy ? "Creating…" : "New trip"}
              </button>
              <Link href="/account" className="btn btn-ghost">
                Account
              </Link>
            </div>
            <details style={{ marginTop: "1rem" }}>
              <summary className="muted">Link another trip with invite code</summary>
              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>Invite code</span>
                <input
                  value={adoptCode}
                  placeholder="e.g. H34XFE"
                  autoCapitalize="characters"
                  onChange={(e) =>
                    setAdoptCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || adoptCode.trim().length < 4}
                onClick={() => void linkExistingTrip()}
              >
                Link trip
              </button>
            </details>
          </>
        )}

        {msg ? (
          <p
            className={
              msg.toLowerCase().includes("could not") || msg.toLowerCase().includes("wrong")
                ? "route-warn"
                : "estimate-msg"
            }
          >
            {msg}
          </p>
        ) : null}
      </>
    );
  }

  // —— Guest: official login home ——
  return (
    <>
      <section className="home-hero">
        <p className="home-hero-eyebrow">Group trip planning</p>
        <h1>Trip Ready</h1>
        <p className="home-hero-meta">
          Organisers sign in here. Travellers join with an invite code — no account needed.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{mode === "signup" ? "Create organiser account" : "Organiser sign in"}</h2>
          <p>Email and password. Each account gets its own list of holidays.</p>
        </div>

        <div className="toolbar" style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className={mode === "signin" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => {
              setMode("signin");
              setMsg(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => {
              setMode("signup");
              setMsg(null);
            }}
          >
            Create account
          </button>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAuth();
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !email.trim().includes("@") || password.length < 6}
          onClick={() => void handleAuth()}
        >
          {busy
            ? mode === "signup"
              ? "Creating…"
              : "Signing in…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>

        <p className="muted" style={{ margin: "1.25rem 0 0" }}>
          Traveller? <Link href="/join">Join with code + email</Link>
        </p>
      </section>

      {msg ? (
        <p
          className={
            msg.toLowerCase().includes("wrong") ||
            msg.toLowerCase().includes("could not") ||
            msg.toLowerCase().includes("failed")
              ? "route-warn"
              : "estimate-msg"
          }
        >
          {msg}
        </p>
      ) : null}
    </>
  );
}
