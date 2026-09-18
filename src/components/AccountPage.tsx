"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { findOwnerPerson, OWNER_FULL_NAME, withOwnerFullName, isEmailTravellerMeta } from "@/lib/cloudMeta";
import { createBlankTrip } from "@/lib/seed";
import { loadTrip } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import { createCloudTrip, setMemberPerson } from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";
import { formatAuthError } from "@/lib/authErrors";

export function AccountPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, membershipReady, user, meta, setMeta, signInWithEmail, signOut } =
    useCloud();
  const { trip, replaceTrip } = useTrip();
  const [email, setEmail] = useState("");
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
    setMsg("Link sent — check your inbox (and spam). Don’t tap again; that burns the hourly limit.");
  }

  async function startTrip() {
    if (!user) return;
    setBusy(true);
    setMsg(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setMsg("Supabase is not configured.");
      return;
    }
    // Migrate any leftover local draft once; otherwise start blank
    let seed = createBlankTrip();
    try {
      const local = loadTrip();
      if (local) seed = withOwnerFullName(local);
    } catch {
      seed = createBlankTrip();
    }
    const owner = findOwnerPerson(seed.people);
    const res = await createCloudTrip(
      client,
      seed,
      owner?.name || user.email || undefined,
    );
    setBusy(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    if (owner) {
      await setMemberPerson(client, res.tripId, owner.id, OWNER_FULL_NAME);
    }
    setMeta({
      tripId: res.tripId,
      inviteCode: res.inviteCode,
      role: "owner",
      personId: owner?.id,
    });
    replaceTrip(seed);
    setMsg("Trip created. Add bookings, then invite travellers.");
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
  const missingEmails =
    trip?.people.filter((p) => !p.email?.trim()).map((p) => p.name) ?? [];

  return (
    <>
      <PageHeader title="Account" />

      {!user && !emailTraveller ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Sign in</h2>
          </div>
          <p className="muted" style={{ margin: "0 0 0.85rem" }}>
            Organisers sign in to build and save the trip. Travellers use{" "}
            <Link href="/join">invite code + email</Link> instead.
          </p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setLinkSent(false);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || linkSent || !email.trim()}
            onClick={() => void sendMagicLink()}
          >
            {busy ? "Sending…" : linkSent ? "Link sent" : "Email me a link"}
          </button>
          <p className="muted" style={{ margin: "1rem 0 0" }}>
            Have an invite? <Link href="/join">Join a trip</Link>
          </p>
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
            ) : (
              <>
                Joined with <strong>{meta?.travellerEmail}</strong>
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
            <>
              <p className="muted" style={{ margin: "0 0 0.85rem" }}>
                Create a private trip under this login. Only you can edit bookings
                and details; travellers you invite can update packing and readiness.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void startTrip()}
              >
                {busy ? "Creating…" : "Start organising"}
              </button>
              <p className="muted" style={{ margin: "1rem 0 0" }}>
                Or <Link href="/join">join with an invite code</Link>
              </p>
            </>
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
              {emailTraveller ? "Leave trip" : "Sign out"}
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
