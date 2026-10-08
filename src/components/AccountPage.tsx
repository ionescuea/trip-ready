"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import {
  findOwnerPerson,
  isEmailOrganiserMeta,
  isEmailTravellerMeta,
  OWNER_FULL_NAME,
  withOwnerFullName,
} from "@/lib/cloudMeta";
import { createBlankTrip } from "@/lib/seed";
import { loadTrip } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import {
  claimOrganiserByCode,
  createCloudTrip,
  setMemberPerson,
} from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";
import { formatAuthError } from "@/lib/authErrors";

type AuthMode = "signin" | "signup";

export function AccountPage() {
  const router = useRouter();
  const search = useSearchParams();
  const {
    configured,
    ready,
    membershipReady,
    user,
    meta,
    setMeta,
    signUpWithPassword,
    signInWithPassword,
    signOut,
  } = useCloud();
  const { trip, replaceTrip } = useTrip();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adoptCode, setAdoptCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const join = search.get("join");
    if (join) {
      router.replace(`/join?code=${encodeURIComponent(join.toUpperCase())}`);
    }
  }, [search, router]);

  // Keep owner linked to Elena-Alexandra Ionescu when she’s on the trip
  useEffect(() => {
    if (!trip || !meta?.tripId || !user) return;
    const named = withOwnerFullName(trip);
    const owner = findOwnerPerson(named.people);
    if (!owner) return;

    if (named !== trip && owner.name === OWNER_FULL_NAME) {
      replaceTrip(named);
    }

    if (meta.role && meta.role !== "owner") return;
    if (meta.personId === owner.id && owner.name === OWNER_FULL_NAME) return;

    const client = createClient();
    if (!client) return;
    setMeta({ ...meta, personId: owner.id });
    void setMemberPerson(client, meta.tripId, owner.id, OWNER_FULL_NAME);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.people, meta?.tripId, meta?.role, user?.id]);

  const inviteUrl = useMemo(() => {
    if (!meta?.inviteCode) return "";
    const origin = publicAppOrigin();
    if (!origin) return "";
    return `${origin}/join?code=${meta.inviteCode}`;
  }, [meta?.inviteCode]);

  const shareMessage = useMemo(() => {
    if (!meta?.inviteCode || !inviteUrl) return "";
    const tripLabel = trip?.destination?.trim() || trip?.name || "our trip";
    return [
      `You're invited to ${tripLabel} on Trip Ready.`,
      ``,
      `1. Open: ${inviteUrl}`,
      `2. Enter this invite code if needed: ${meta.inviteCode}`,
      `3. Enter the email the organiser saved for you`,
      ``,
      `No password needed — just code + email.`,
    ].join("\n");
  }, [meta?.inviteCode, inviteUrl, trip?.destination, trip?.name]);

  const linkedName = useMemo(() => {
    if (!meta?.personId || !trip) return null;
    return trip.people.find((p) => p.id === meta.personId)?.name ?? null;
  }, [meta?.personId, trip]);

  async function copyText(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(ok);
    } catch {
      setMsg("Could not copy — select the text manually.");
    }
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
    setMsg(
      mode === "signup"
        ? "Account created — loading your trip…"
        : "Signed in — loading your trip…",
    );
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
    setBusy(false);
    if (created.error || !created.tripId) {
      setMsg(formatAuthError(created.error) || "Could not create trip.");
      return;
    }
    setMeta({
      tripId: created.tripId,
      inviteCode: created.inviteCode,
      role: "owner",
      personId: owner?.id,
    });
    replaceTrip(seed);
    setMsg("Trip created. Add traveller emails on packing pages, then copy the invite.");
    router.push("/");
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
    setBusy(false);
    if (res.error || !res.tripId || !res.trip) {
      setMsg(formatAuthError(res.error) || "Could not open that trip.");
      return;
    }
    const owner = findOwnerPerson(res.trip.people);
    setMeta({
      tripId: res.tripId,
      inviteCode: res.inviteCode,
      role: "owner",
      personId: owner?.id,
    });
    replaceTrip(res.trip);
    setMsg("Trip linked to your account — you can edit everything.");
    router.push("/");
  }

  if (!ready || !membershipReady) {
    return (
      <>
        <PageHeader title="Account" />
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Loading…
          </p>
        </section>
      </>
    );
  }

  if (!configured) {
    return (
      <>
        <PageHeader title="Account" />
        <section className="panel">
          <div className="panel-head">
            <h2>Cloud not configured</h2>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
            .env.local, then restart.
          </p>
        </section>
      </>
    );
  }

  const isTraveller = meta?.role === "traveller";
  const emailTraveller = isEmailTravellerMeta(meta);
  const emailOrganiser = isEmailOrganiserMeta(meta);
  const hasAccess = Boolean(user || emailTraveller || emailOrganiser);
  const missingEmails =
    trip?.people.filter((p) => !p.email?.trim()).map((p) => p.name) ?? [];

  return (
    <>
      <PageHeader title="Account" />

      {!hasAccess ? (
        <section className="panel">
          <div className="panel-head">
            <h2>{mode === "signup" ? "Create organiser account" : "Organiser sign in"}</h2>
            <p>
              Email and password — no magic link. Travellers still use Join with
              code + their email.
            </p>
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

          <p className="muted" style={{ margin: "1rem 0 0" }}>
            Traveller? <Link href="/join">Join with code + email</Link>
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>
              {!meta
                ? "Set up your trip"
                : isTraveller
                  ? "Your access"
                  : "Your trip"}
            </h2>
          </div>

          <p style={{ margin: "0 0 0.85rem" }}>
            {user ? (
              <>
                Signed in as <strong>{user.email}</strong>
              </>
            ) : emailOrganiser ? (
              <>
                Organiser <strong>{meta?.organiserEmail}</strong>
                <span className="muted">
                  {" "}
                  (legacy email access — create a password account to keep control)
                </span>
              </>
            ) : (
              <>
                Traveller <strong>{meta?.travellerEmail}</strong>
              </>
            )}
            {linkedName ? (
              <>
                {" "}
                · <strong>{linkedName}</strong>
              </>
            ) : null}
          </p>

          {user && !meta ? (
            <>
              <p className="muted" style={{ margin: "0 0 0.85rem" }}>
                No trip on this account yet. Start fresh, or link the trip you already
                ran (use the same email as before, plus the invite code).
              </p>
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
                    placeholder="e.g. WD6KXT"
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
                  Link this trip to my account
                </button>
              </details>
            </>
          ) : isTraveller ? (
            <p className="muted" style={{ margin: 0 }}>
              You’re in as a traveller
              {meta?.travellerEmail ? ` (${meta.travellerEmail})` : ""}. Packing and
              readiness for your name sync automatically. Leave anytime — ticks stay
              saved on the trip.
            </p>
          ) : meta ? (
            <>
              <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                Changes save to your account. Add each traveller’s email on their
                packing page, then share the invite.
              </p>
              {missingEmails.length > 0 ? (
                <p className="estimate-msg" style={{ margin: "0 0 0.75rem" }}>
                  Still need emails for: {missingEmails.join(", ")}
                </p>
              ) : null}
              <div className="invite-code-block">
                <span className="invite-code-label">Invite code</span>
                <strong className="invite-code-value">{meta.inviteCode}</strong>
              </div>
              <div className="toolbar" style={{ marginTop: "0.85rem" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void copyText(shareMessage, "Invite copied — paste into WhatsApp.")
                  }
                >
                  Copy invite
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void copyText(meta.inviteCode, "Code copied.")}
                >
                  Copy code
                </button>
              </div>
            </>
          ) : null}

          <div className="toolbar" style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void signOut()}
            >
              {emailTraveller || emailOrganiser ? "Leave trip" : "Sign out"}
            </button>
          </div>
        </section>
      )}

      {msg ? (
        <p
          className={
            msg.toLowerCase().includes("error") ||
            msg.toLowerCase().includes("could not") ||
            msg.toLowerCase().includes("failed") ||
            msg.toLowerCase().includes("wrong")
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
