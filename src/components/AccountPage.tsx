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
    if (!meta?.inviteCode || typeof window === "undefined") return "";
    return `${window.location.origin}/join?code=${meta.inviteCode}`;
  }, [meta?.inviteCode]);

  const shareMessage = useMemo(() => {
    if (!meta?.inviteCode || !inviteUrl) return "";
    const tripLabel = trip?.destination?.trim() || trip?.name || "our trip";
    return [
      `You're invited to ${tripLabel} on Trip Ready.`,
      ``,
      `1. Open this link: ${inviteUrl}`,
      `2. Enter your email — you'll get a sign-in link`,
      `3. Choose your name on the trip`,
      `4. Tick your documents & packing list until they're green`,
      ``,
      `Invite code (if you need it): ${meta.inviteCode}`,
    ].join("\n");
  }, [meta?.inviteCode, inviteUrl, trip?.destination, trip?.name]);

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
    setMsg(res.error || "Check your email for the magic link, then come back here.");
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
    setMsg(
      `Cloud sync on. Linked as ${OWNER_FULL_NAME}. Copy the invite message below and send it to travellers.`,
    );
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
            <h2>Supabase not configured</h2>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
            .env.local, then restart.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Account & sync" />

      <section className="panel">
        <div className="panel-head">
          <h2>Sign in</h2>
        </div>
        {user ? (
          <div className="cloud-signed-in">
            <p style={{ margin: 0 }}>
              Signed in as <strong>{user.email}</strong>
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <div>
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
              {busy ? "Sending…" : "Email magic link"}
            </button>
          </div>
        )}
      </section>

      {user ? (
        <>
          <section className="panel" style={{ marginTop: "1rem" }}>
            <div className="panel-head">
              <h2>This trip in the cloud</h2>
            </div>
            {meta ? (
              <div className="cloud-meta">
                <div className="invite-code-block">
                  <span className="invite-code-label">Invite code</span>
                  <strong className="invite-code-value">{meta.inviteCode}</strong>
                </div>
                <p className="muted" style={{ margin: "0.65rem 0 0" }}>
                  {meta.role ?? "member"}
                  {meta.personId
                    ? ` · ${trip?.people.find((p) => p.id === meta.personId)?.name ?? ""}`
                    : ""}
                </p>
                {meta.role !== "traveller" ? (
                  <>
                    <p className="muted" style={{ margin: "0.5rem 0 0", wordBreak: "break-all" }}>
                      {inviteUrl}
                    </p>
                    <div className="toolbar" style={{ marginTop: "0.85rem" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          void copyText(
                            shareMessage,
                            "Invite message copied — paste into WhatsApp or email.",
                          )
                        }
                      >
                        Copy invite message
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void copyText(meta.inviteCode, "Code copied.")}
                      >
                        Copy code
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void copyText(inviteUrl, "Link copied.")}
                      >
                        Copy link
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ margin: "0.65rem 0 0" }}>
                    You’re joined as a traveller — you can update your packing list and your
                    readiness ticks only.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() => {
                    setMeta(null);
                    setMsg("Disconnected this device from cloud trip (local copy kept).");
                  }}
                >
                  Disconnect this device
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !trip}
                onClick={() => void enableCloud()}
              >
                {busy ? "Creating…" : "Upload this trip & get invite code"}
              </button>
            )}
          </section>

          <section className="panel" style={{ marginTop: "1rem" }}>
            <div className="panel-head">
              <h2>Joining as a traveller?</h2>
            </div>
            <p className="muted" style={{ margin: "0 0 0.85rem" }}>
              Use the dedicated join page — enter the code, sign in, pick your name.
            </p>
            <Link href="/join" className="btn btn-primary">
              Open join page
            </Link>
          </section>

          {meta && trip ? (
            <section className="panel" style={{ marginTop: "1rem" }}>
              <div className="panel-head">
                <h2>Who I am</h2>
              </div>
              {meta.role === "traveller" ? (
                <p style={{ margin: 0 }}>
                  Linked as{" "}
                  <strong>
                    {trip.people.find((p) => p.id === meta.personId)?.name ?? "traveller"}
                  </strong>
                </p>
              ) : (
                <label className="field">
                  <span>Traveller</span>
                  <select
                    value={meta.personId ?? findOwnerPerson(trip.people)?.id ?? ""}
                    onChange={(e) => {
                      const personId = e.target.value;
                      const person = trip.people.find((p) => p.id === personId);
                      setMeta({ ...meta, personId });
                      const client = createClient();
                      if (client && meta.tripId) {
                        void setMemberPerson(
                          client,
                          meta.tripId,
                          personId,
                          person?.name,
                        ).then((r) => {
                          if (r.error) setMsg(r.error);
                          else setMsg(`Linked as ${person?.name ?? personId}.`);
                        });
                      }
                    }}
                  >
                    {trip.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {msg ? (
        <p
          className={
            msg.toLowerCase().includes("error") ||
            msg.toLowerCase().includes("could not") ||
            msg.toLowerCase().includes("failed") ||
            msg.toLowerCase().includes("sign in")
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
