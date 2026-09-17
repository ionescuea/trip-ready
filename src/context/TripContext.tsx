"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { peopleList } from "@/lib/bookingDetails";
import { extractAllFromText, type ExtractResult } from "@/lib/extract";
import { computeFlags } from "@/lib/flags";
import {
  claimPeopleForBookingNames,
  dedupeRosterPeople,
  mergePeopleNames,
  namesMatch,
} from "@/lib/names";
import { parseTransferMinutes } from "@/lib/parking";
import {
  createBlankTrip,
  withChecklistForPeople,
  withLuggageForPeople,
} from "@/lib/seed";
import { clearTrip, loadTrip, saveTrip } from "@/lib/storage";
import { pickNewerTrip, withOwnerFullName } from "@/lib/cloudMeta";
import { inferDriverPerson } from "@/lib/driver";
import {
  canEditPersonChecks,
  canEditTripStructure,
  confirmOwnerEditOther,
  isOwnerEditingOther,
} from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { fetchRemoteTrip, pushTrip } from "@/lib/tripCloud";
import { useCloud } from "@/context/CloudContext";
import type {
  Booking,
  CellStatus,
  ChecklistKey,
  ChecklistState,
  Flag,
  LuggageKey,
  LuggageState,
  Trip,
} from "@/lib/types";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function remapPersonState(
  state: ChecklistState | LuggageState | undefined,
  idMap: Record<string, string>,
): ChecklistState | LuggageState {
  const src = state ?? {};
  const next: ChecklistState | LuggageState = { ...src };
  for (const [fromId, toId] of Object.entries(idMap)) {
    const fromRow = next[fromId];
    if (!fromRow) continue;
    next[toId] = { ...(next[toId] ?? {}), ...fromRow };
    delete next[fromId];
  }
  return next;
}

function markBookingPresence(
  people: Trip["people"],
  checklist: ChecklistState,
  key: "on_flight" | "on_hotel",
  bookingPeople?: string,
): ChecklistState {
  const bookingNames = peopleList(bookingPeople);
  if (!bookingNames.length) return checklist;
  const claimed = claimPeopleForBookingNames(people, bookingNames);
  const next = { ...checklist };
  for (const person of people) {
    const hit = claimed.has(person.id);
    next[person.id] = {
      ...next[person.id],
      [key]: hit ? "done" : next[person.id]?.[key] === "done" ? "done" : "attention",
    };
  }
  return next;
}

/**
 * Fix saved trips: dedupe Elena / Elena-Alexandra and re-apply booking name matches.
 * Safe to run on every load.
 */
export function reconcileTripNames(trip: Trip): Trip {
  const peopleIn = Array.isArray(trip.people) ? trip.people : [];
  const bookingsIn = Array.isArray(trip.bookings) ? trip.bookings : [];

  const { people: deduped, idMap } = dedupeRosterPeople(peopleIn);
  let people = deduped;
  let checklist = remapPersonState(trip.checklist, idMap) as ChecklistState;
  let luggage = remapPersonState(trip.luggage, idMap) as LuggageState;

  const bookingNames = bookingsIn.flatMap((b) => peopleList(b.extracted?.people));
  if (bookingNames.length) {
    people = mergePeopleNames(people, bookingNames, () => uid("p"));
  }

  checklist = withChecklistForPeople(people, checklist);
  luggage = withLuggageForPeople(people, luggage);

  const flight = bookingsIn.find((b) => b.type === "flight");
  const hotel = bookingsIn.find((b) => b.type === "hotel");
  checklist = markBookingPresence(people, checklist, "on_flight", flight?.extracted?.people);
  checklist = markBookingPresence(people, checklist, "on_hotel", hotel?.extracted?.people);

  const tickets = (trip.tickets ?? []).map((ticket) => {
    if (!ticket.personId) return ticket;
    const mapped = idMap[ticket.personId];
    return mapped && mapped !== ticket.personId
      ? { ...ticket, personId: mapped }
      : ticket;
  });

  let driverPersonId = trip.driverPersonId;
  if (driverPersonId && idMap[driverPersonId]) {
    driverPersonId = idMap[driverPersonId];
  }

  return withOwnerFullName({
    ...trip,
    people,
    bookings: bookingsIn,
    checklist,
    luggage,
    tickets,
    driverPersonId,
  });
}

export function readinessLabel(trip: Trip, redFlagCount: number) {
  const cells = Object.values(trip.checklist).flatMap((row) => Object.values(row));
  const todos = cells.filter((c) => c === "todo" || c === "attention").length;
  if (redFlagCount === 0 && todos === 0) return { text: "Ready", className: "status-ready" };
  if (redFlagCount <= 2 && todos <= 4) return { text: "Almost", className: "status-almost" };
  return { text: "Not ready", className: "status-not" };
}

function mergePeopleFromBookings(trip: Trip, bookings: Booking[]): Pick<Trip, "people" | "checklist" | "luggage"> {
  const bookingNames: string[] = [];
  const seenNorm = new Set<string>();
  for (const b of bookings) {
    for (const n of peopleList(b.extracted.people)) {
      const key = n.toLowerCase();
      if (seenNorm.has(key)) continue;
      // Skip short first names that are already covered by a fuller roster name
      if (
        trip.people.some((p) => namesMatch(p.name, n)) &&
        !bookingNames.some((x) => namesMatch(x, n))
      ) {
        // Still record for matching, but prefer not creating duplicates later
      }
      seenNorm.add(key);
      bookingNames.push(n);
    }
  }

  if (bookingNames.length === 0 && trip.people.length > 0) {
    return {
      people: trip.people,
      checklist: trip.checklist,
      luggage: trip.luggage ?? {},
    };
  }

  const people = mergePeopleNames(trip.people, bookingNames, () => uid("p"));

  return {
    people,
    checklist: withChecklistForPeople(people, trip.checklist),
    luggage: withLuggageForPeople(people, trip.luggage),
  };
}

function tripMetaFromBookings(bookings: Booking[], current: Trip): Partial<Trip> {
  const flight = bookings.find((b) => b.type === "flight")?.extracted;
  const hotel = bookings.find((b) => b.type === "hotel")?.extracted;
  const parking = bookings.find((b) => b.type === "parking")?.extracted;

  const destination =
    current.destination?.trim() ||
    hotel?.name?.trim() ||
    flight?.arrivalAirport?.trim() ||
    "";

  const startDate =
    current.startDate?.trim() ||
    flight?.startDate?.trim() ||
    hotel?.startDate?.trim() ||
    parking?.startDate?.trim() ||
    "";

  const endDate =
    current.endDate?.trim() ||
    flight?.endDate?.trim() ||
    hotel?.endDate?.trim() ||
    parking?.endDate?.trim() ||
    "";

  const toTown =
    current.toTown?.trim() ||
    parking?.name?.trim() ||
    parking?.airport?.trim() ||
    flight?.departureAirport?.trim() ||
    current.driveAirport?.trim() ||
    "";

  const name =
    current.name !== "My trip" && current.name.trim()
      ? current.name
      : destination
        ? `Trip to ${destination}`
        : current.name;

  let driverPersonId = current.driverPersonId;
  if (!driverPersonId && current.people.length > 0) {
    driverPersonId = inferDriverPerson({ ...current, bookings })?.id;
  }

  return {
    name,
    destination,
    startDate,
    endDate,
    ...(toTown && !current.toTown?.trim() ? { toTown } : {}),
    ...(driverPersonId && !current.driverPersonId ? { driverPersonId } : {}),
  };
}

type TripContextValue = {
  trip: Trip | null;
  hydrated: boolean;
  flags: Flag[];
  status: { text: string; className: string } | null;
  lastNotes: string[];
  extracting: boolean;
  cloudSyncing: boolean;
  cloudError: string | null;
  update: (mutator: (t: Trip) => Trip) => void;
  /** Name / pick-up address — owner any person; traveller only self. */
  updatePersonDetails: (personId: string, mutator: (t: Trip) => Trip) => void;
  replaceTrip: (trip: Trip) => void;
  ingest: (text: string, sourceName: string) => Promise<void>;
  resetTrip: () => void;
  addTraveller: () => void;
  toggleChecklist: (personId: string, key: ChecklistKey) => void;
  toggleLuggage: (personId: string, key: LuggageKey) => void;
  setChecklistStatus: (personId: string, key: ChecklistKey, status: CellStatus) => void;
  setLuggageStatus: (personId: string, key: LuggageKey, status: CellStatus) => void;
};

const TripContext = createContext<TripContextValue | null>(null);

const CYCLE: CellStatus[] = ["todo", "done", "attention", "na"];

function nextStatus(current: CellStatus | undefined): CellStatus {
  const i = CYCLE.indexOf(current ?? "todo");
  return CYCLE[(i + 1) % CYCLE.length];
}

export function TripProvider({ children }: { children: ReactNode }) {
  const { configured, ready: cloudReady, user, meta } = useCloud();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [lastNotes, setLastNotes] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const canPersist = useRef(false);
  const skipNextPush = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const existing = loadTrip();
      if (existing) {
        try {
          setTrip(reconcileTripNames(existing));
        } catch (err) {
          console.error("[trip-ready] Reconcile failed — keeping saved trip as-is", err);
          setTrip(existing);
        }
      } else {
        setTrip(createBlankTrip());
      }
    } catch (err) {
      console.error("[trip-ready] Load failed", err);
      setTrip(createBlankTrip());
    } finally {
      canPersist.current = true;
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !cloudReady || !configured || !user || !meta?.tripId) return;
    const client = createClient();
    if (!client) return;
    let cancelled = false;

    (async () => {
      setCloudSyncing(true);
      setCloudError(null);
      const remote = await fetchRemoteTrip(client, meta.tripId);
      if (cancelled) return;
      if (remote?.data) {
        setTrip((local) => {
          const base = local ?? createBlankTrip();
          const chosen = pickNewerTrip(base, remote.data);
          skipNextPush.current = true;
          try {
            return reconcileTripNames(chosen);
          } catch {
            return chosen;
          }
        });
      }
      setCloudSyncing(false);
    })();

    const channel = client
      .channel(`trip:${meta.tripId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: `id=eq.${meta.tripId}`,
        },
        (payload) => {
          const row = payload.new as { data?: Trip; updated_at?: string };
          if (!row?.data) return;
          skipNextPush.current = true;
          setTrip((local) => {
            const base = local ?? createBlankTrip();
            const remoteTrip = {
              ...row.data!,
              updatedAt: row.updated_at || row.data!.updatedAt,
            };
            try {
              return reconcileTripNames(pickNewerTrip(base, remoteTrip));
            } catch {
              return pickNewerTrip(base, remoteTrip);
            }
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [hydrated, cloudReady, configured, user?.id, meta?.tripId]);

  useEffect(() => {
    if (!canPersist.current || !hydrated || !trip) return;
    saveTrip(trip);
  }, [trip, hydrated]);

  useEffect(() => {
    if (!canPersist.current || !hydrated || !trip) return;
    if (!configured || !user || !meta?.tripId) return;
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const client = createClient();
      if (!client || !meta.tripId) return;
      setCloudSyncing(true);
      void pushTrip(client, meta.tripId, trip).then((res) => {
        setCloudSyncing(false);
        setCloudError(res.error ?? null);
      });
    }, 800);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [trip, hydrated, configured, user?.id, meta?.tripId]);

  const flags = useMemo(() => (trip ? computeFlags(trip) : []), [trip]);
  const status = trip
    ? readinessLabel(trip, flags.filter((f) => f.severity === "red").length)
    : null;

  const update = useCallback(
    (mutator: (t: Trip) => Trip) => {
      // Travellers may not change trip structure (bookings, leave-by, roster, etc.)
      if (!canEditTripStructure(meta)) return;
      setTrip((current) => (current ? mutator(current) : current));
    },
    [meta],
  );

  /** Traveller profile fields (name, pick-up address) including own address for travellers. */
  const updatePersonDetails = useCallback(
    (personId: string, mutator: (t: Trip) => Trip) => {
      if (!canEditPersonChecks(meta, personId)) return;
      if (isOwnerEditingOther(meta, personId)) {
        const name =
          trip?.people.find((p) => p.id === personId)?.name?.trim() || "this traveller";
        if (!confirmOwnerEditOther(name)) return;
      }
      setTrip((current) => (current ? mutator(current) : current));
    },
    [meta, trip?.people],
  );

  /** Checklist / luggage toggles — travellers only for their own person. */
  const updateChecks = useCallback(
    (personId: string, mutator: (t: Trip) => Trip) => {
      if (!canEditPersonChecks(meta, personId)) return;
      if (isOwnerEditingOther(meta, personId)) {
        const name =
          trip?.people.find((p) => p.id === personId)?.name?.trim() || "this traveller";
        if (!confirmOwnerEditOther(name)) return;
      }
      setTrip((current) => (current ? mutator(current) : current));
    },
    [meta, trip?.people],
  );

  const replaceTrip = useCallback((next: Trip) => {
    skipNextPush.current = false;
    try {
      setTrip(reconcileTripNames(next));
    } catch {
      setTrip(next);
    }
  }, []);

  const applyResults = useCallback(
    (text: string, sourceName: string, results: ExtractResult[], extraNotes: string[] = []) => {
      setLastNotes(
        [
          ...extraNotes,
          results.length > 1
            ? `Found ${results.length} bookings in this file: ${results.map((r) => r.type).join(", ")}.`
            : "",
          ...results.flatMap((r) => r.notes),
        ].filter(Boolean),
      );

      update((t) => {
        let nextBookings = [...t.bookings];
        let parkingMinutes = t.parkingMinutes;
        let toTown = t.toTown;
        let paidLead = false;

        for (const result of results) {
          const booking: Booking = {
            id: uid("b"),
            type: result.type,
            sourceName,
            rawText: text,
            extracted: result.fields,
            confirmed: result.autoConfirmed,
            createdAt: new Date().toISOString(),
          };

          nextBookings =
            result.type === "other"
              ? [...nextBookings, booking]
              : result.type === "experience"
                ? [
                    ...nextBookings.filter((b) => {
                      if (b.type !== "experience") return true;
                      const a = `${b.extracted.name}|${b.extracted.startDate}|${b.extracted.startTime}`;
                      const c = `${booking.extracted.name}|${booking.extracted.startDate}|${booking.extracted.startTime}`;
                      return a !== c;
                    }),
                    booking,
                  ]
                : [...nextBookings.filter((b) => b.type !== result.type), booking];

          if (result.type === "flight") {
            if (result.fields.status === "paid" || result.fields.status === "confirmed") {
              paidLead = true;
            }
            if (!toTown?.trim() && result.fields.departureAirport?.trim()) {
              toTown = result.fields.departureAirport.trim();
            }
          }

          if (result.type === "parking") {
            const oakwood = /oakwood/i.test(
              `${result.fields.name ?? ""} ${result.fields.usefulInfo ?? ""}`,
            );
            parkingMinutes = parseTransferMinutes(
              result.fields,
              oakwood ? 5 : (parkingMinutes ?? 25),
            );
            if (oakwood) parkingMinutes = 5;
            if (!toTown?.trim()) {
              toTown =
                result.fields.name?.trim() ||
                result.fields.airport?.trim() ||
                toTown;
            }
          }
        }

        const merged = mergePeopleFromBookings(t, nextBookings);

        let nextChecklist = merged.checklist;
        const flightBooking = nextBookings.find((b) => b.type === "flight");
        const hotelBooking = nextBookings.find((b) => b.type === "hotel");
        nextChecklist = markBookingPresence(
          merged.people,
          nextChecklist,
          "on_flight",
          flightBooking?.extracted.people,
        );
        nextChecklist = markBookingPresence(
          merged.people,
          nextChecklist,
          "on_hotel",
          hotelBooking?.extracted.people,
        );

        if (paidLead && merged.people[0]) {
          const lead = merged.people[0];
          nextChecklist[lead.id] = { ...nextChecklist[lead.id], paid: "done" };
        }

        const meta = tripMetaFromBookings(nextBookings, { ...t, toTown });

        return {
          ...t,
          ...meta,
          bookings: nextBookings,
          people: merged.people,
          checklist: nextChecklist,
          luggage: merged.luggage,
          parkingMinutes,
          toTown: toTown || meta.toTown,
        };
      });
    },
    [update],
  );

  const ingest = useCallback(
    async (text: string, sourceName: string) => {
      if (!canEditTripStructure(meta)) return;
      setExtracting(true);
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = (await res.json()) as {
          results?: ExtractResult[];
          note?: string;
          source?: string;
          error?: string;
        };

        if (!res.ok || !data.results?.length) {
          let local: ExtractResult[] = [];
          try {
            local = extractAllFromText(text);
          } catch {
            local = [];
          }
          applyResults(text, sourceName, local, [
            data.error ||
              data.note ||
              "Extract API unavailable — used the built-in reader.",
          ]);
          return;
        }

        applyResults(text, sourceName, data.results, [
          data.note ||
            (data.source === "ai"
              ? "Extracted with AI."
              : "Extracted with the built-in reader."),
        ]);
      } catch {
        let local: ExtractResult[] = [];
        try {
          local = extractAllFromText(text);
        } catch {
          local = [];
        }
        applyResults(text, sourceName, local, [
          local.length
            ? "Offline — extracted with the built-in reader."
            : "Could not extract that confirmation. Try pasting the full email text.",
        ]);
      } finally {
        setExtracting(false);
      }
    },
    [applyResults, meta],
  );

  const resetTrip = useCallback(() => {
    if (!canEditTripStructure(meta)) return;
    clearTrip();
    setTrip(createBlankTrip());
    setLastNotes([]);
  }, [meta]);

  const addTraveller = useCallback(() => {
    if (!canEditTripStructure(meta)) return;
    update((t) => {
      const person = { id: uid("p"), name: `Traveller ${t.people.length + 1}` };
      const people = [...t.people, person];
      return {
        ...t,
        people,
        checklist: withChecklistForPeople(people, t.checklist),
        luggage: withLuggageForPeople(people, t.luggage),
      };
    });
  }, [update, meta]);

  const toggleChecklist = useCallback(
    (personId: string, key: ChecklistKey) => {
      updateChecks(personId, (t) => {
        const current = t.checklist[personId]?.[key];
        return {
          ...t,
          checklist: {
            ...t.checklist,
            [personId]: {
              ...t.checklist[personId],
              [key]: nextStatus(current),
            },
          },
        };
      });
    },
    [updateChecks],
  );

  const toggleLuggage = useCallback(
    (personId: string, key: LuggageKey) => {
      updateChecks(personId, (t) => {
        const luggage = t.luggage ?? {};
        const current = luggage[personId]?.[key];
        return {
          ...t,
          luggage: {
            ...luggage,
            [personId]: {
              ...luggage[personId],
              [key]: nextStatus(current),
            },
          },
        };
      });
    },
    [updateChecks],
  );

  const setChecklistStatus = useCallback(
    (personId: string, key: ChecklistKey, status: CellStatus) => {
      updateChecks(personId, (t) => ({
        ...t,
        checklist: {
          ...t.checklist,
          [personId]: { ...t.checklist[personId], [key]: status },
        },
      }));
    },
    [updateChecks],
  );

  const setLuggageStatus = useCallback(
    (personId: string, key: LuggageKey, status: CellStatus) => {
      updateChecks(personId, (t) => {
        const luggage = t.luggage ?? {};
        return {
          ...t,
          luggage: {
            ...luggage,
            [personId]: { ...luggage[personId], [key]: status },
          },
        };
      });
    },
    [updateChecks],
  );

  const value: TripContextValue = {
    trip,
    hydrated,
    flags,
    status,
    lastNotes,
    extracting,
    cloudSyncing,
    cloudError,
    update,
    updatePersonDetails,
    replaceTrip,
    ingest,
    resetTrip,
    addTraveller,
    toggleChecklist,
    toggleLuggage,
    setChecklistStatus,
    setLuggageStatus,
  };

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip must be used within TripProvider");
  return ctx;
}
