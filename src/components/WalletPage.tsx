"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { renderPdfUrlToImages } from "@/lib/pdf";
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
import type { Person, TicketPass } from "@/lib/types";

const WALLET_ASSIGN_KEY = "trip-ready-wallet-assign-person";

function PersonAssignPicker({
  people,
  value,
  disabled,
  onChange,
}: {
  people: Person[];
  value: string;
  disabled?: boolean;
  onChange: (personId: string) => void;
}) {
  return (
    <div className="wallet-person-picker" role="group" aria-label="Who is this for">
      <button
        type="button"
        className={`wallet-person-chip${value === "" ? " active" : ""}`}
        disabled={disabled}
        onClick={() => onChange("")}
      >
        Everyone
      </button>
      {people.map((p) => (
        <button
          type="button"
          key={p.id}
          className={`wallet-person-chip${value === p.id ? " active" : ""}`}
          disabled={disabled}
          onClick={() => onChange(p.id)}
        >
          {p.name.trim() || "Traveller"}
        </button>
      ))}
    </div>
  );
}

export function WalletPage() {
  const { trip, update } = useTrip();
  const { meta, configured, user } = useCloud();
  const { canEditTrip, isTraveller, myPersonId } = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Survives iOS file-picker remounts better than state alone. */
  const assignPersonRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [personId, setPersonId] = useState("");
  const [label, setLabel] = useState("");
  const [viewer, setViewer] = useState<{
    ticket: TicketPass;
    url: string;
    kind: "image" | "pdf";
  } | null>(null);
  const [pdfPages, setPdfPages] = useState<string[] | null>(null);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "loading" | "error">("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(WALLET_ASSIGN_KEY);
      if (saved != null) {
        assignPersonRef.current = saved;
        setPersonId(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setAssignPerson = useCallback((id: string) => {
    assignPersonRef.current = id;
    setPersonId(id);
    try {
      sessionStorage.setItem(WALLET_ASSIGN_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const visible = useMemo(() => {
    if (!trip) return [];
    return ticketsForViewer(trip, {
      personId: myPersonId,
      isOwner: canEditTrip,
    });
  }, [trip, myPersonId, canEditTrip]);

  useEffect(() => {
    if (!viewer || viewer.kind !== "pdf") {
      setPdfPages(null);
      setPdfStatus("idle");
      setPdfError(null);
      return;
    }

    let cancelled = false;
    setPdfPages(null);
    setPdfStatus("loading");
    setPdfError(null);

    void renderPdfUrlToImages(viewer.url, { scale: 2.25, maxPages: 4 })
      .then((pages) => {
        if (cancelled) return;
        setPdfPages(pages);
        setPdfStatus("idle");
      })
      .catch((e) => {
        if (cancelled) return;
        setPdfStatus("error");
        setPdfError(e instanceof Error ? e.message : "Could not show this PDF.");
      });

    return () => {
      cancelled = true;
    };
  }, [viewer]);

  const openPass = useCallback(
    async (ticket: TicketPass) => {
      setMsg(null);
      setBusy(true);
      try {
        const client = configured && user ? createClient() : null;
        const res = await resolveTicketUrl({ client, ticket });
        if (res.error || !res.url) {
          setMsg(res.error || "Could not open pass.");
          return;
        }

        const asImage =
          isImageTicket(ticket) ||
          /\.(jpe?g|png|webp|gif)$/i.test(ticket.fileName);

        setViewer({
          ticket,
          url: res.url,
          kind: asImage ? "image" : "pdf",
        });
      } finally {
        setBusy(false);
      }
    },
    [configured, user],
  );

  async function onFileChosen(file: File | null) {
    if (!file || !trip || !canEditTrip) return;
    setBusy(true);
    setMsg(null);
    // Prefer ref — iOS often resets React state when returning from the file picker.
    const assignedPersonId = assignPersonRef.current || personId || null;
    try {
      const client = configured && user ? createClient() : null;
      const cloudTripId = meta?.tripId ?? null;
      const draft = createTicketMeta({
        label: label.trim() || file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        personId: assignedPersonId,
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
      const who =
        assignedPersonId
          ? trip.people.find((p) => p.id === assignedPersonId)?.name.trim() || "traveller"
          : "everyone";
      setMsg(
        up.storagePath
          ? `Pass added for ${who}.`
          : `Pass saved on this device for ${who}. Upload the trip to the cloud so travellers can open it on their phones.`,
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
          <div className="field">
            <span>Who is this for?</span>
            <PersonAssignPicker
              people={trip.people}
              value={personId}
              disabled={busy}
              onChange={setAssignPerson}
            />
            {trip.people.length === 0 ? (
              <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
                No travellers yet — <Link href="/travellers">add people in Pack</Link> to assign
                a pass to someone.
              </p>
            ) : null}
          </div>
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
            onClick={() => {
              assignPersonRef.current = personId;
              try {
                sessionStorage.setItem(WALLET_ASSIGN_KEY, personId);
              } catch {
                /* ignore */
              }
              fileRef.current?.click();
            }}
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
                    <PersonAssignPicker
                      people={trip.people}
                      value={ticket.personId ?? ""}
                      disabled={busy}
                      onChange={(id) =>
                        update((t) =>
                          withTicketUpdated(t, ticket.id, {
                            personId: id || null,
                          }),
                        )
                      }
                    />
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
            {viewer.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewer.url} alt={viewer.ticket.label} />
            ) : pdfStatus === "loading" ? (
              <p className="wallet-pdf-status">Preparing boarding pass…</p>
            ) : pdfPages && pdfPages.length > 0 ? (
              <div className="wallet-pdf-pages">
                {pdfPages.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${viewer.ticket.id}-${i}`}
                    src={src}
                    alt={`${viewer.ticket.label} page ${i + 1}`}
                  />
                ))}
              </div>
            ) : (
              <div className="wallet-pdf-fallback">
                <p>{pdfError || "Could not show this PDF in the app."}</p>
                <a
                  className="btn btn-primary"
                  href={viewer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PDF
                </a>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
