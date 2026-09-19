"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { createClient } from "@/lib/supabase/client";
import { claimTripByEmail } from "@/lib/tripCloud";
import { formatAuthError } from "@/lib/authErrors";

export function JoinPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, user, meta, setMeta, signOut } = useCloud();
  const { replaceTrip } = useTrip();

  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = (search.get("code") || search.get("join") || "").toUpperCase();
    if (fromUrl) setCode(fromUrl);
  }, [search]);

  async function join() {
    setBusy(true);
    setError(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setError("Cloud is not configured.");
      return;
    }
    // Clear organiser session on this device if any
    if (user) await signOut();
    const res = await claimTripByEmail(client, code, email);
    setBusy(false);
    if (res.error || !res.tripId || !res.personId) {
      setError(
        formatAuthError(res.error) ||
          "No traveller with that email on this trip. Ask the organiser to add your email on your packing page.",
      );
      return;
    }
    setMeta({
      tripId: res.tripId,
      inviteCode: res.inviteCode,
      role: "traveller",
      personId: res.personId,
      travellerEmail: email.trim().toLowerCase(),
    });
    if (res.trip) replaceTrip(res.trip);
    router.push(`/travellers/${res.personId}`);
  }

  if (!ready) {
    return (
      <>
        <PageHeader title="Join trip" />
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
        <PageHeader title="Join trip" />
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Cloud sync is not set up on this app yet.
          </p>
        </section>
      </>
    );
  }

  if (meta?.role === "traveller" && meta.personId) {
    return (
      <>
        <PageHeader title="Join trip" />
        <section className="panel">
          <div className="panel-head">
            <h2>You’re in</h2>
            <p>Your packing list and readiness ticks are ready.</p>
          </div>
          <Link href={`/travellers/${meta.personId}`} className="btn btn-primary">
            Open my checklist
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Join trip" />

      <p className="join-intro">
        Enter the invite code and the email the organiser saved for you — no magic
        link needed.
      </p>
      <p className="muted" style={{ margin: "0 0 1rem" }}>
        Organising this trip? Don’t use this form —{" "}
        <Link href="/account">sign in on Account</Link> so you can edit bookings.
      </p>

      <section className="panel">
        <div className="panel-head">
          <h2>Your details</h2>
        </div>
        <label className="field">
          <span>Invite code</span>
          <input
            value={code}
            placeholder="e.g. PERQC6"
            autoCapitalize="characters"
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
            }
          />
        </label>
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
          disabled={busy || code.trim().length < 4 || !email.trim()}
          onClick={() => void join()}
        >
          {busy ? "Opening…" : "Open my trip"}
        </button>
      </section>

      {error ? <p className="route-warn">{error}</p> : null}

      <p className="muted" style={{ marginTop: "1rem" }}>
        Organising the trip? <Link href="/account">Sign in here</Link>
      </p>
    </>
  );
}
