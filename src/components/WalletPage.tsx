"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ViewOnlyBanner } from "@/components/PermissionBanners";
import { useCloud } from "@/context/CloudContext";
import { useTrip } from "@/context/TripContext";
import { usePermissions } from "@/hooks/usePermissions";
import { preferredPdfScale, renderPdfUrlToImages, splitPdfFileToPages } from "@/lib/pdf";
import type { SplitPdfPage } from "@/lib/pdf";
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
  ticketsForViewer,
  ticketsOf,
  withTicketAdded,
  withTicketRemoved,
  withTicketsAdded,
  withTicketsCleared,
} from "@/lib/tickets";
import type { Person, TicketPass } from "@/lib/types";

const WALLET_FILTER_KEY = "trip-ready-wallet-filter-person";

/** Prefer server unpdf text when the phone pdf.js extract is empty/weak. */
async function withServerPageText(
  file: File,
  pages: SplitPdfPage[],
): Promise<SplitPdfPage[]> {
  const weak =
    pages.length === 0 ||
    pages.every((p) => p.text.trim().length < 12) ||
    pages.some((p) => p.text.trim().length < 8);

  if (!weak) return pages;

  try {
    const form = new FormData();
    form.append("file", file);
    form.append("pages", "1");
    const res = await fetch("/api/pdf-text", { method: "POST", body: form });
    const data = (await res.json()) as {
      error?: string;
      pages?: string[];
    };
    if (!res.ok || !data.pages?.length) return pages;

    return pages.map((p, i) => {
      const serverText = data.pages?.[i]?.trim() || "";
      if (!serverText) return p;
      if (p.text.trim().length >= serverText.length) return p;
      return { ...p, text: serverText };
    });
  } catch {
    return pages;
  }
}

function PersonFilterPicker({
  people,
  value,
  counts,
  disabled,
  onChange,
}: {
  people: Person[];
  value: string;
  counts: Record<string, number>;
  disabled?: boolean;
  onChange: (personId: string) => void;
}) {
  return (
    <div className="wallet-person-picker" role="group" aria-label="Traveller">
      {people.map((p) => {
        const n = counts[p.id] ?? 0;
        return (
          <button
            type="button"
            key={p.id}
            className={`wallet-person-chip${value === p.id ? " active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(p.id)}
          >
            {p.name.trim() || "Traveller"}
            {n > 0 ? ` · ${n}` : ""}
          </button>
        );
      })}
    </div>
  );
}

export function WalletPage() {
  const { trip, update } = useTrip();
  const { meta, configured, user } = useCloud();
  const { canEditTrip, isTraveller, myPersonId } = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);
  const filterPersonRef = useRef("");
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

  const setFilterPerson = useCallback((id: string) => {
    filterPersonRef.current = id;
    setPersonId(id);
    try {
      sessionStorage.setItem(WALLET_FILTER_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(WALLET_FILTER_KEY);
      if (saved) {
        filterPersonRef.current = saved;
        setPersonId(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const passCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!trip) return counts;
    for (const t of ticketsOf(trip)) {
      if (!t.personId) continue;
      counts[t.personId] = (counts[t.personId] ?? 0) + 1;
    }
    return counts;
  }, [trip]);

  const visible = useMemo(() => {
    if (!trip) return [];
    if (canEditTrip) {
      if (!personId) return [];
      return ticketsOf(trip).filter((t) => t.personId === personId);
    }
    return ticketsForViewer(trip, {
      personId: myPersonId,
      isOwner: false,
    });
  }, [trip, myPersonId, canEditTrip, personId]);

  useEffect(() => {
    if (!trip || !canEditTrip || personId) return;
    if (myPersonId && trip.people.some((p) => p.id === myPersonId)) {
      setFilterPerson(myPersonId);
      return;
    }
    const first = trip.people[0];
    if (first) setFilterPerson(first.id);
  }, [trip, canEditTrip, personId, myPersonId, setFilterPerson]);

  useEffect(() => {
    if (!viewer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("wallet-viewer-open");
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.classList.remove("wallet-viewer-open");
    };
  }, [viewer]);

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

    void renderPdfUrlToImages(viewer.url, {
      scale: preferredPdfScale(),
      maxPages: 12,
    })
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
    const selectedPersonId = filterPersonRef.current || personId || "";
    const baseLabel = label.trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      const client = configured && user ? createClient() : null;
      const cloudTripId = meta?.tripId ?? null;
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);

      if (isPdf) {
        setMsg("Matching boarding passes to traveller names…");
        let pages = await splitPdfFileToPages(file);
        pages = await withServerPageText(file, pages);
        let matched = assignPassPagesByName(pages, trip.people);

        // Second chance: always overlay server text if first pass matched nothing
        if (matched.length === 0) {
          pages = await withServerPageText(file, pages.map((p) => ({ ...p, text: "" })));
          matched = assignPassPagesByName(pages, trip.people);
        }

        if (matched.length === 0) {
          const anyText = pages.some((p) => p.text.trim().length >= 8);
          setMsg(
            anyText
              ? "Couldn’t match roster names on this PDF. In Pack, use the same names as on the passes (e.g. Elena Morosanu), then upload again."
              : "Couldn’t read passenger names from this PDF on your phone. Try again on Wi‑Fi, or use a text PDF (not a photo scan).",
          );
          return;
        }

        const created: TicketPass[] = [];
        const seq = new Map<string, number>();
        for (const row of matched) {
          const n = (seq.get(row.personId) ?? 0) + 1;
          seq.set(row.personId, n);
          const pageLabel =
            n === 1
              ? `${baseLabel} — ${row.personName}`
              : `${baseLabel} — ${row.personName} (${n})`;

          const draft = createTicketMeta({
            label: pageLabel,
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
        const summary = [...seq.entries()]
          .map(([id, n]) => {
            const name =
              trip.people.find((p) => p.id === id)?.name.trim() || "Traveller";
            return `${name} ×${n}`;
          })
          .join(", ");
        setMsg(`Matched ${created.length} passes (${summary}).`);
        if (matched[0]?.personId) setFilterPerson(matched[0].personId);
        return;
      }

      if (!selectedPersonId) {
        setMsg("Select a traveller, then upload their pass photo.");
        return;
      }
      const draft = createTicketMeta({
        label: baseLabel,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        personId: selectedPersonId,
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
        trip.people.find((p) => p.id === selectedPersonId)?.name.trim() ||
        "traveller";
      setMsg(`Pass added for ${who}.`);
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

  async function clearAllPasses() {
    if (!canEditTrip || !trip) return;
    const n = ticketsOf(trip).length;
    if (!n) return;
    if (
      !confirm(
        `Remove all ${n} wallet passes? Upload the boarding-pass PDF again to rematch by name.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const client = configured && user ? createClient() : null;
      for (const ticket of ticketsOf(trip)) {
        await deleteTicketFile({ client, ticket });
      }
      update((t) => withTicketsCleared(t));
      setMsg("Wallet cleared. Upload the PDF once to match names again.");
    } finally {
      setBusy(false);
    }
  }

  if (!trip) return null;

  const filterName = personId
    ? trip.people.find((p) => p.id === personId)?.name.trim()
    : null;
  const unassigned = ticketsOf(trip).filter((t) => !t.personId).length;

  return (
    <>
      <PageHeader title="Wallet" />
      {isTraveller ? (
        <ViewOnlyBanner>
          Your boarding passes for the airport — open one full screen to show at security.
        </ViewOnlyBanner>
      ) : (
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Upload the boarding-pass PDF once — we match each page to names in Pack. Then tap a
          traveller to see only their passes (e.g. 2 tickets for Elena).
        </p>
      )}

      {canEditTrip ? (
        <section className="panel wallet-upload">
          <div className="panel-head">
            <h2>Travellers</h2>
          </div>
          {trip.people.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              <Link href="/travellers">Add people in Pack</Link> using the same names as on the
              boarding passes.
            </p>
          ) : (
            <PersonFilterPicker
              people={trip.people}
              value={personId}
              counts={passCounts}
              disabled={busy}
              onChange={setFilterPerson}
            />
          )}
          <label className="field" style={{ marginTop: "1rem" }}>
            <span>Label (optional)</span>
            <input
              type="text"
              value={label}
              placeholder="e.g. easyJet"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif"
            hidden
            onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
          />
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                filterPersonRef.current = personId;
                fileRef.current?.click();
              }}
            >
              {busy ? "Working…" : "Upload boarding PDF"}
            </button>
            {ticketsOf(trip).length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void clearAllPasses()}
              >
                Clear wallet
              </button>
            ) : null}
          </div>
          {unassigned > 0 ? (
            <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.88rem" }}>
              {unassigned} unassigned pass{unassigned === 1 ? "" : "es"} hidden — use Clear
              wallet, then re-upload to rematch by name.
            </p>
          ) : null}
          {!meta?.tripId ? (
            <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.88rem" }}>
              Tip:{" "}
              <Link href="/account">upload the trip to the cloud</Link> so passes sync to phones.
            </p>
          ) : null}
        </section>
      ) : null}

      {msg ? <p className="estimate-msg">{msg}</p> : null}

      {canEditTrip && filterName ? (
        <h2 className="wallet-person-heading">{filterName}</h2>
      ) : null}

      {visible.length === 0 ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            {canEditTrip
              ? filterName
                ? `No passes for ${filterName} yet. Upload the group boarding PDF (names are matched automatically).`
                : "Select a traveller above."
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void removePass(ticket)}
                  >
                    Remove
                  </button>
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
              <div className="wallet-image-stage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={viewer.url} alt={viewer.ticket.label} />
              </div>
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
