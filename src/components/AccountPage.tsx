"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { findOwnerPerson, isEmailOrganiserMeta, isEmailTravellerMeta, OWNER_FULL_NAME, withOwnerFullName } from "@/lib/cloudMeta";
import { createBlankTrip } from "@/lib/seed";
import { loadTrip } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import {
  adoptOrganiserByCode,
  createTripByOrganiserEmail,
  openOrganiserByEmail,
  setMemberPerson,
} from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";
import { formatAuthError } from "@/lib/authErrors";

export function AccountPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, membershipReady, user, meta, setMeta, signInWithEmail, verifyEmailOtp, signOut } =
    useCloud();
  const { trip, replaceTrip } = useTrip();
  const [email, setEmail] = useState("");
  const [adoptCode, setAdoptCode] = useState("");
  const [otp, setOtp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

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
      `No magic link — just code + email.`,
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

  async function continueAsOrganiser() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setMsg("Enter a valid organiser email.");
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

    // Prefer existing trip for this email
    const existing = await openOrganiserByEmail(client, trimmed);
    if (existing.tripId && existing.trip) {
      const owner = findOwnerPerson(existing.trip.people);
      setMeta({
        tripId: existing.tripId,
        inviteCode: existing.inviteCode,
        role: "owner",
        personId: owner?.id,
        organiserEmail: trimmed,
      });
      replaceTrip(existing.trip);
      setBusy(false);
      setMsg("Welcome back — trip loaded.");
      router.push("/");
      return;
    }

    // No trip yet — create one (or adopt below)
    const seed = seedTripLocal();
    const owner = findOwnerPerson(seed.people);
    const created = await createTripByOrganiserEmail(client, trimmed, seed);
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
      organiserEmail: trimmed,
    });
    replaceTrip(created.trip ?? { ...seed, organiserEmail: trimmed });
    setMsg("Trip created. Add traveller emails on packing pages, then copy the invite.");
    router.push("/");
  }

  async function adoptExistingTrip() {
    const trimmed = email.trim().toLowerCase();
    const code = adoptCode.trim().toUpperCase();
    if (!trimmed.includes("@") || code.length < 4) {
      setMsg("Enter your email and the existing invite code.");
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
    const res = await adoptOrganiserByCode(client, code, trimmed);
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
      organiserEmail: trimmed,
    });
    replaceTrip(res.trip);
    setMsg("Trip linked to your email — you can edit everything.");
    router.push("/");
  }

  async function sendMagicLink() {
    if (linkSent) return;
    setBusy(true);
    setMsg(null);
    const res = await signInWithEmail(email);
    setBusy(false);
    if (res.error) {
      setMsg(formatAuthError(res.error));
      return;
    }
    setLinkSent(true);
    setOtp("");
    setMsg("Legacy magic link sent — prefer email login above for phones.");
  }

  async function confirmOtp() {
    if (!otp.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await verifyEmailOtp(email, otp);
    setBusy(false);
    if (res.error) {
      setMsg(formatAuthError(res.error));
      return;
    }
    setMsg("Signed in — loading your trip…");
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
            <h2>Organiser access</h2>
            <p>
              Enter your email — no magic link. Same email opens this trip on any
              phone. Travellers use Join with code + their email.
            </p>
          </div>
          <label className="field">
            <span>Your email</span>
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !email.trim().includes("@")}
            onClick={() => void continueAsOrganiser()}
          >
            {busy ? "Opening…" : "Continue as organiser"}
          </button>

          <details style={{ marginTop: "1.25rem" }}>
            <summary className="muted">Already have an invite code? (link existing trip)</summary>
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
              disabled={busy || adoptCode.trim().length < 4 || !email.trim().includes("@")}
              onClick={() => void adoptExistingTrip()}
            >
              Link this trip to my email
            </button>
          </details>

          <p className="muted" style={{ margin: "1rem 0 0" }}>
            Traveller? <Link href="/join">Join with code + email</Link>
          </p>

          <details style={{ marginTop: "1rem" }}>
            <summary className="muted">Legacy magic link (unreliable on iPhone)</summary>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: "0.75rem" }}
              disabled={busy || linkSent || !email.trim()}
              onClick={() => void sendMagicLink()}
            >
              {busy && !linkSent ? "Sending…" : linkSent ? "Email sent" : "Email me a link"}
            </button>
            {linkSent ? (
              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>6-digit code (only if email shows one)</span>
                <input
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: "0.5rem" }}
                  disabled={busy || otp.trim().length < 6}
                  onClick={() => void confirmOtp()}
                >
                  Sign in with code
                </button>
              </label>
            ) : null}
          </details>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>
              {!meta ? "Start your trip" : isTraveller ? "Your access" : "Your trip"}
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

          {!meta ? (
            <p className="muted" style={{ margin: 0 }}>
              No trip on this login yet. Sign out and use <strong>Continue as organiser</strong>{" "}
              with your email.
            </p>
          ) : isTraveller ? (
            <p className="muted" style={{ margin: 0 }}>
              You’re in as a traveller
              {meta.travellerEmail ? ` (${meta.travellerEmail})` : ""}. Packing and
              readiness for your name sync automatically. Leave anytime — ticks stay
              saved on the trip.
            </p>
          ) : (
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
          )}

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
