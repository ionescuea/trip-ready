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
import { isLocalDevOrigin, publicAppOrigin } from "@/lib/appUrl";

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
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setMsg(
      "Check your email for the magic link. It opens the live site (tripreaddyy.netlify.app) — ignore any old localhost links.",
    );
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
                <p className="estimate-msg" style={{ margin: "0 0 0.75rem" }}>
                  Saved in Supabase — bookings and trip details stay available on any device
                  when you sign in with this account (and for travellers who joined with the
                  invite).
                </p>
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
                    {isLocalDevOrigin() ? (
                      <p className="estimate-msg" style={{ margin: "0.65rem 0 0" }}>
                        You’re on localhost — invite links still point at the live site
                        so travellers can open them on their phones.
                      </p>
                    ) : null}
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
              <>
                <p className="muted" style={{ margin: "0 0 0.85rem" }}>
                  Right now this trip only lives in this browser. Upload it to the cloud so
                  bookings and details aren’t lost if you clear site data or switch phones.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !trip}
                  onClick={() => void enableCloud()}
                >
                  {busy ? "Creating…" : "Upload this trip & get invite code"}
                </button>
              </>
            )}
          </section>

          {user ? (
            <section className="panel" style={{ marginTop: "1rem" }}>
              <div className="panel-head">
                <h2>Test before inviting others</h2>
              </div>
              <ol className="join-steps account-test-steps" aria-label="How to test sync">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Sign in with your email</strong>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                      Magic link → you’re the owner (linked as {OWNER_FULL_NAME}).
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Upload this trip &amp; get invite code</strong>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                      That copies everything you’ve already entered (bookings, leave-by, day
                      trips, wallet, packing) into the cloud. Local data is not wiped.
                    </p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Open the app on your phone</strong>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                      Same email magic link → you should see the same trip. Change something
                      small on one device and refresh the other to confirm sync.
                    </p>
                  </div>
                </li>
                <li>
                  <span>4</span>
                  <div>
                    <strong>Optional — traveller view</strong>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                      Use a <em>second</em> email (e.g. you+adina@gmail.com) on{" "}
                      <Link href="/join">/join</Link> with the invite code, pick Adina or Elena
                      Morosanu. Don’t join as a traveller with the same owner account on this
                      trip — that confuses “who I am”.
                    </p>
                  </div>
                </li>
              </ol>
              {!meta ? (
                <p className="estimate-msg" style={{ margin: "0.85rem 0 0" }}>
                  Start with steps 1–2 above. Only share the invite once phone sync looks right.
                </p>
              ) : (
                <p className="estimate-msg" style={{ margin: "0.85rem 0 0" }}>
                  Cloud is on (code <strong>{meta.inviteCode}</strong>). Safe to test on your
                  phone with this email before messaging the others.
                </p>
              )}
            </section>
          ) : null}

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
