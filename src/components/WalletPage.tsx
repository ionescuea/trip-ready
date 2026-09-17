"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { renderPdfUrlToImages, splitPdfFileToPages } from "@/lib/pdf";
import { createClient } from "@/lib/supabase/client";
import {
  deleteTicketFile,
  resolveTicketUrl,
  uploadTicketFile,
} from "@/lib/ticketStorage";
import {
  assignPassPagesByName,
  createTicketMeta,
  isImageTicket,
  isPdfTicket,
  ticketPersonLabel,
  ticketsForViewer,
  withTicketAdded,
  withTicketRemoved,
  withTicketsAdded,
  withTicketUpdated,
} from "@/lib/tickets";
import type { Person, TicketPass } from "@/lib/types";

const WALLET_ASSIGN_KEY = "trip-ready-wallet-assign-person";

function PersonAssignPicker({
  people,
  value,
  disabled,
  onChange,
  everyoneLabel = "Everyone",
}: {
  people: Person[];
  value: string;
  disabled?: boolean;
  onChange: (personId: string) => void;
  everyoneLabel?: string;
}) {
  return (
    <div className="wallet-person-picker" role="group" aria-label="Traveller">
      <button
        type="button"
        className={`wallet-person-chip${value === "" ? " active" : ""}`}
        disabled={disabled}
        onClick={() => onChange("")}
      >
        {everyoneLabel}
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
      filterPersonId: canEditTrip ? personId : null,
    });
  }, [trip, myPersonId, canEditTrip, personId]);

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

    void renderPdfUrlToImages(viewer.url, { scale: 2.25, maxPages: 12 })
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
    const filterPersonId = assignPersonRef.current || personId || "";
    const baseLabel = label.trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      const client = configured && user ? createClient() : null;
      const cloudTripId = meta?.tripId ?? null;
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);

      if (isPdf) {
        setMsg("Reading names on boarding passes…");
        const pages = await splitPdfFileToPages(file);
        const matched = assignPassPagesByName(pages, trip.people, {
          onlyPersonId: filterPersonId || null,
        });

        if (matched.length === 0) {
          // No name match — store as one pass for the selected person or Everyone
          const draft = createTicketMeta({
            label: baseLabel,
            fileName: file.name,
            mimeType: "application/pdf",
            personId: filterPersonId || null,
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
            filterPersonId
              ? "Pass added. Couldn’t read a matching name on the PDF — assigned to the traveller you selected."
              : "Pass added for Everyone. Couldn’t match roster names on the PDF — pick a traveller on the card, or check names in Pack match the pass.",
          );
          return;
        }

        const created: TicketPass[] = [];
        for (const row of matched) {
          const draft = createTicketMeta({
            label: `${baseLabel} — ${row.personName}`,
            fileName: row.page.file.name,
            mimeType: "image/jpeg",
            personId: row.personId,
          });
          const up = await uploadTicketFile({
            client,
            cloudTripId,
            ticketId: draft.id,
            file: row.page.file,
          });
          if (up.error) {
            setMsg(up.error);
            if (created.length) update((t) => withTicketsAdded(t, created));
            return;
          }
          created.push({
            ...draft,
            storagePath: up.storagePath,
            dataUrl: up.storagePath ? undefined : up.dataUrl ?? row.page.dataUrl,
          });
        }

        update((t) => withTicketsAdded(t, created));
        setLabel("");
        const names = matched.map((m) => m.personName).join(", ");
        setMsg(
          matched.length === 1
            ? `Pass added for ${names}.`
            : `Added ${matched.length} passes from names on the tickets: ${names}.`,
        );
        return;
      }

      // Photo / image upload
      const draft = createTicketMeta({
        label: baseLabel,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        personId: filterPersonId || null,
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
        filterPersonId
          ? trip.people.find((p) => p.id === filterPersonId)?.name.trim() ||
            "traveller"
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

  const filterName = personId
    ? trip.people.find((p) => p.id === personId)?.name.trim()
    : null;

  return (
    <>
      <PageHeader title="Wallet" />
      {isTraveller ? (
        <ViewOnlyBanner>
          Your boarding passes for the airport — open one full screen to show at security.
        </ViewOnlyBanner>
      ) : (
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Upload a group boarding-pass PDF with <strong>All travellers</strong> selected — we
          match each page to names like Elena Morosanu. Tap a name to see only that person’s
          passes.
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
            <span>Show / match traveller</span>
            <PersonAssignPicker
              people={trip.people}
              value={personId}
              disabled={busy}
              onChange={setAssignPerson}
              everyoneLabel="All travellers"
            />
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
              All travellers: auto-split the PDF by names printed on each pass. A single name:
              only keep that person’s pass from the PDF (and filter the list).
            </p>
            {trip.people.length === 0 ? (
              <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
                No travellers yet — <Link href="/travellers">add people in Pack</Link> using the
                same names as on the boarding passes.
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

      {canEditTrip && filterName ? (
        <p className="muted" style={{ margin: "0 0 0.75rem" }}>
          Showing passes for <strong>{filterName}</strong> only.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            {canEditTrip
              ? filterName
                ? `No passes for ${filterName} yet — upload a PDF with All travellers, or assign one below.`
                : "No passes yet — upload a boarding pass PDF or a clear photo of the QR code."
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
