"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { createClient } from "@/lib/supabase/client";
import { joinCloudTrip, lookupInvite } from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";
import { formatAuthError } from "@/lib/authErrors";

export function JoinPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, user, meta, setMeta, signInWithEmail } = useCloud();
  const { replaceTrip } = useTrip();

  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [tripName, setTripName] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    const fromUrl = (search.get("code") || search.get("join") || "").toUpperCase();
    if (fromUrl) setCode(fromUrl);
  }, [search]);

  // After sign-in (or when code ready), load traveller list
  useEffect(() => {
    if (!ready || !configured || !user || !code.trim() || code.trim().length < 4) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      const client = createClient();
      if (!client) {
        setBusy(false);
        return;
      }
      const res = await lookupInvite(client, code);
      if (cancelled) return;
      setBusy(false);
      if (res.error) {
        setError(res.error);
        setPeople([]);
        return;
      }
      setTripName(res.name);
      setPeople(res.people);
      setPersonId((prev) => prev || res.people[0]?.id || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, configured, user?.id, code]);

  const step = useMemo(() => {
    if (!configured) return "setup";
    if (!code.trim()) return "code";
    if (!user) return "signin";
    if (meta?.tripId && meta.inviteCode?.toUpperCase() === code.trim().toUpperCase()) {
      return "done";
    }
    if (people.length > 0) return "pick";
    return "loading";
  }, [configured, code, user, meta, people.length]);

  async function sendLink() {
    if (linkSent) return;
    setBusy(true);
    setError(null);
    const origin = publicAppOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
    const redirectTo = origin
      ? `${origin}/join?code=${encodeURIComponent(code.trim().toUpperCase())}`
      : undefined;
    const res = await signInWithEmail(email, redirectTo);
    setBusy(false);
    if (res.error) {
      setError(formatAuthError(res.error));
      return;
    }
    setLinkSent(true);
  }

  async function join() {
    if (!user || !personId) return;
    setBusy(true);
    setError(null);
    const client = createClient();
    if (!client) {
      setBusy(false);
      setError("Supabase is not configured.");
      return;
    }
    const person = people.find((p) => p.id === personId);
    const res = await joinCloudTrip(
      client,
      code,
      personId,
      person?.name || user.email || undefined,
    );
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setMeta({
      tripId: res.tripId,
      inviteCode: res.inviteCode,
      role: "traveller",
      personId,
    });
    if (res.trip) replaceTrip(res.trip);
    router.push(personId ? `/travellers/${personId}` : "/");
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

  return (
    <>
      <PageHeader title="Join trip" />

      <p className="join-intro">
        Someone shared a Trip Ready invite with you. Follow the steps — takes about a minute.
      </p>

      <ol className="join-steps" aria-label="How to join">
        <li className={step === "code" ? "active" : code ? "done" : ""}>
          <span>1</span> Enter invite code
        </li>
        <li className={step === "signin" ? "active" : user ? "done" : ""}>
          <span>2</span> Sign in with email
        </li>
        <li className={step === "pick" ? "active" : step === "done" ? "done" : ""}>
          <span>3</span> Choose your name
        </li>
      </ol>

      {step === "setup" ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Cloud sync is not set up on this app yet.
          </p>
        </section>
      ) : null}

      {step === "code" || (!user && code) || (user && !people.length && code) ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Invite code</h2>
          </div>
          <label className="field">
            <span>Code from your trip organiser</span>
            <input
              value={code}
              placeholder="e.g. PERQC6"
              autoCapitalize="characters"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                setPeople([]);
                setLinkSent(false);
              }}
            />
          </label>
        </section>
      ) : null}

      {step === "signin" || (!user && code.trim().length >= 4) ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel-head">
            <h2>Your email</h2>
          </div>
          <label className="field">
            <span>We’ll email you a sign-in link</span>
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
            disabled={busy || linkSent || !email.trim() || code.trim().length < 4}
            onClick={() => void sendLink()}
          >
            {busy ? "Sending…" : linkSent ? "Link sent" : "Email me a link"}
          </button>
          {linkSent ? (
            <p className="estimate-msg">
              Check your inbox (and spam). Open the link on this phone — don’t tap
              again; that burns the hourly email limit.
            </p>
          ) : null}
        </section>
      ) : null}

      {step === "pick" ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel-head">
            <h2>{tripName || "Your trip"}</h2>
          </div>
          <label className="field">
            <span>I am</span>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !personId}
            onClick={() => void join()}
          >
            {busy ? "Joining…" : "Join trip"}
          </button>
        </section>
      ) : null}

      {step === "done" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>You’re in</h2>
          </div>
          <Link
            href={meta?.personId ? `/travellers/${meta.personId}` : "/"}
            className="btn btn-primary"
          >
            Open my checklist
          </Link>
        </section>
      ) : null}

      {step === "loading" && user ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            Looking up trip…
          </p>
        </section>
      ) : null}

      {error ? <p className="route-warn">{error}</p> : null}
    </>
  );
}
