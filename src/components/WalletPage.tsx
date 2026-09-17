"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { createClient } from "@/lib/supabase/client";
import {
  deleteTicketFile,
  resolveTicketUrl,
  uploadTicketFile,
} from "@/lib/ticketStorage";
import {
  createTicketMeta,
  isImageTicket,
  isPdfTicket,
  ticketPersonLabel,
  ticketsForViewer,
  withTicketAdded,
  withTicketRemoved,
  withTicketUpdated,
} from "@/lib/tickets";
import type { TicketPass } from "@/lib/types";

export function WalletPage() {
  const { trip, update } = useTrip();
  const { meta, configured, user } = useCloud();
  const { canEditTrip, isTraveller, myPersonId } = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [viewer, setViewer] = useState<{
    ticket: TicketPass;
    url: string;
  } | null>(null);

  const visible = useMemo(() => {
    if (!trip) return [];
    return ticketsForViewer(trip, {
      personId: myPersonId,
      isOwner: canEditTrip,
    });
  }, [trip, myPersonId, canEditTrip]);

  const openPass = useCallback(
    async (ticket: TicketPass) => {
      setMsg(null);
      const client = configured && user ? createClient() : null;
      const res = await resolveTicketUrl({ client, ticket });
      if (res.error || !res.url) {
        setMsg(res.error || "Could not open pass.");
        return;
      }
      setViewer({ ticket, url: res.url });
    },
    [configured, user],
  );

  async function onFileChosen(file: File | null) {
    if (!file || !trip || !canEditTrip) return;
    setBusy(true);
    setMsg(null);
    try {
      const client = configured && user ? createClient() : null;
      const cloudTripId = meta?.tripId ?? null;
      const draft = createTicketMeta({
        label: label.trim() || file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        personId: personId || null,
      });
      const up = await uploadTicketFile({
        client,
        cloudTripId,
        ticketId: draft.id,
        file,
      });
      if (up.error) {
        setMsg(up.error);
        return;
      }
      update((t) =>
        withTicketAdded(t, {
          ...draft,
          storagePath: up.storagePath,
          dataUrl: up.dataUrl,
        }),
      );
      setLabel("");
      setMsg(
        up.storagePath
          ? "Pass added to the shared wallet."
          : "Pass saved on this device. Upload the trip to the cloud so travellers can open it on their phones.",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePass(ticket: TicketPass) {
    if (!canEditTrip) return;
    if (!confirm(`Remove “${ticket.label}”?`)) return;
    setBusy(true);
    try {
      const client = configured && user ? createClient() : null;
      await deleteTicketFile({ client, ticket });
      update((t) => withTicketRemoved(t, ticket.id));
    } finally {
      setBusy(false);
    }
  }

  if (!trip) return null;

  return (
    <>
      <PageHeader title="Wallet" />
      {isTraveller ? (
        <ViewOnlyBanner>
          Your boarding passes for the airport — open one full screen to show at security.
        </ViewOnlyBanner>
      ) : (
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Upload boarding passes or ticket PDFs. Travellers open this page on their phone like
          a wallet.
        </p>
      )}

      {canEditTrip ? (
        <section className="panel wallet-upload">
          <div className="panel-head">
            <h2>Add a pass</h2>
          </div>
          <label className="field">
            <span>Label</span>
            <input
              type="text"
              value={label}
              placeholder="e.g. easyJet boarding pass"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Who is this for?</span>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Everyone</option>
              {trip.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Adding…" : "Upload PDF or photo"}
          </button>
          {!meta?.tripId ? (
            <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.88rem" }}>
              Tip:{" "}
              <Link href="/account">upload the trip to the cloud</Link> so passes sync to
              travellers’ phones.
            </p>
          ) : null}
        </section>
      ) : null}

      {msg ? <p className="estimate-msg">{msg}</p> : null}

      {visible.length === 0 ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            {canEditTrip
              ? "No passes yet — upload a boarding pass PDF or a clear photo of the QR code."
              : "No passes shared with you yet. Ask the trip organiser to upload them."}
          </p>
        </section>
      ) : (
        <ul className="wallet-list">
          {visible.map((ticket) => (
            <li key={ticket.id} className="wallet-card">
              <div className="wallet-card-copy">
                <strong>{ticket.label}</strong>
                <span className="muted">
                  {ticketPersonLabel(trip, ticket)}
                  {" · "}
                  {isPdfTicket(ticket) ? "PDF" : isImageTicket(ticket) ? "Photo" : "File"}
                </span>
              </div>
              <div className="wallet-card-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void openPass(ticket)}
                >
                  Show pass
                </button>
                {canEditTrip ? (
                  <>
                    <label className="wallet-assign">
                      <span className="sr-only">Assign to</span>
                      <select
                        value={ticket.personId ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          update((t) =>
                            withTicketUpdated(t, ticket.id, {
                              personId: e.target.value || null,
                            }),
                          )
                        }
                      >
                        <option value="">Everyone</option>
                        {trip.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void removePass(ticket)}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewer ? (
        <div className="wallet-viewer" role="dialog" aria-modal="true">
          <div className="wallet-viewer-bar">
            <strong>{viewer.ticket.label}</strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setViewer(null)}
            >
              Close
            </button>
          </div>
          <div className="wallet-viewer-body">
            {isImageTicket(viewer.ticket) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewer.url} alt={viewer.ticket.label} />
            ) : (
              <iframe title={viewer.ticket.label} src={viewer.url} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
