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
import { createClient } from "@/lib/supabase/client";
import { setMemberPerson } from "@/lib/tripCloud";
import { publicAppOrigin } from "@/lib/appUrl";

export function AccountPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { configured, ready, membershipReady, user, meta, setMeta, clearSelectedTrip, signOut } =
    useCloud();
  const { trip, replaceTrip } = useTrip();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const join = search.get("join");
    if (join) {
      router.replace(`/join?code=${encodeURIComponent(join.toUpperCase())}`);
    }
  }, [search, router]);

  useEffect(() => {
    if (!ready || !membershipReady) return;
    if (!user && !meta) {
      router.replace("/");
    }
  }, [ready, membershipReady, user, meta, router]);

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

  if (!user && !meta) {
    return (
      <>
        <PageHeader title="Account" />
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Redirecting to sign in…
          </p>
        </section>
      </>
    );
  }

  const isTraveller = meta?.role === "traveller";
  const emailTraveller = isEmailTravellerMeta(meta);
  const emailOrganiser = isEmailOrganiserMeta(meta);
  const missingEmails =
    trip?.people.filter((p) => !p.email?.trim()).map((p) => p.name) ?? [];

  return (
    <>
      <PageHeader title="Account" backHref={user && !isTraveller ? "/" : "/hub"} />

      <section className="panel">
        <div className="panel-head">
          <h2>
            {!meta
              ? "Your account"
              : isTraveller
                ? "Your access"
                : "Open trip"}
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
                (legacy — sign in with a password on the home page to keep control)
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
          <p className="muted" style={{ margin: 0 }}>
            No holiday open.{" "}
            <Link href="/">Choose or start a trip</Link> from your holiday list.
          </p>
        ) : isTraveller ? (
          <p className="muted" style={{ margin: 0 }}>
            You’re in as a traveller
            {meta?.travellerEmail ? ` (${meta.travellerEmail})` : ""}. Packing and
            readiness for your name sync automatically.
          </p>
        ) : meta ? (
          <>
            <p className="muted" style={{ margin: "0 0 0.75rem" }}>
              Add each traveller’s email on their packing page, then share the invite.
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
          {user && meta && !isTraveller ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                clearSelectedTrip();
                router.push("/");
              }}
            >
              Back to holidays
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void signOut()}
          >
            {emailTraveller || emailOrganiser ? "Leave trip" : "Sign out"}
          </button>
        </div>
      </section>

      {msg ? <p className="estimate-msg">{msg}</p> : null}
    </>
  );
}
