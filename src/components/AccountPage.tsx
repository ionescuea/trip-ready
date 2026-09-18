"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { findOwnerPerson, OWNER_FULL_NAME, withOwnerFullName } from "@/lib/cloudMeta";
import { createClient } from "@/lib/supabase/client";
import { createCloudTrip, setMemberPerson } from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";

export function AccountPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, user, meta, setMeta, signInWithEmail, signOut } = useCloud();
  const { trip, replaceTrip } = useTrip();
  const [email, setEmail] = useState("");
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
      `Open this link: ${inviteUrl}`,
      `Sign in with your email, then choose your name.`,
      ``,
      `Code if you need it: ${meta.inviteCode}`,
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
    setBusy(true);
    setMsg(null);
    const res = await signInWithEmail(email);
    setBusy(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setMsg("Check your email — open the link on this device.");
  }

  async function enableCloud() {
    if (!trip || !user) return;
    setBusy(true);
    setMsg(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setMsg("Supabase is not configured.");
      return;
    }
    const named = withOwnerFullName(trip);
    if (named !== trip) replaceTrip(named);
    const owner = findOwnerPerson(named.people);
    const res = await createCloudTrip(
      client,
      named,
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
    setMsg("Trip saved. Copy the invite below to share with travellers.");
  }

  if (!ready) {
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

  return (
    <>
      <PageHeader title="Account" />

      {!user ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Sign in</h2>
          </div>
          <p className="muted" style={{ margin: "0 0 0.85rem" }}>
            Use the same email on phone and computer so your trip stays in sync.
          </p>
          <label className="field">
            <span>Email</span>
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
            disabled={busy || !email.trim()}
            onClick={() => void sendMagicLink()}
          >
            {busy ? "Sending…" : "Email me a link"}
          </button>
          <p className="muted" style={{ margin: "1rem 0 0" }}>
            Have an invite?{" "}
            <Link href="/join">Join a trip</Link>
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>{meta ? "Synced" : "Save & share"}</h2>
          </div>

          <p style={{ margin: "0 0 0.85rem" }}>
            Signed in as <strong>{user.email}</strong>
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
                This trip only lives in this browser until you save it. After that,
                sign in on any device to get the same bookings, wallet, and packing.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !trip}
                onClick={() => void enableCloud()}
              >
                {busy ? "Saving…" : "Save trip to cloud"}
              </button>
              <p className="muted" style={{ margin: "1rem 0 0" }}>
                Or <Link href="/join">join someone else’s trip</Link>
              </p>
            </>
          ) : isTraveller ? (
            <p className="muted" style={{ margin: 0 }}>
              You’re on the shared trip. Packing and readiness ticks sync
              automatically.
            </p>
          ) : (
            <>
              <div className="invite-code-block">
                <span className="invite-code-label">Invite code</span>
                <strong className="invite-code-value">{meta.inviteCode}</strong>
              </div>
              <p className="muted" style={{ margin: "0.75rem 0 0" }}>
                Travellers open the link, sign in, and pick their name.
              </p>
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
            {meta ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setMeta(null);
                  setMsg("Disconnected — local trip kept on this device.");
                }}
              >
                Disconnect
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
              Sign out
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
