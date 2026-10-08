"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  isEmailAccessMeta,
  loadCloudMeta,
  saveCloudMeta,
  type CloudMeta,
} from "@/lib/cloudMeta";
import { clearTrip } from "@/lib/storage";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  claimOrganiserByEmail,
  fetchMyOwnerTrips,
  fetchMyTravellerMembership,
  type OwnerTripSummary,
} from "@/lib/tripCloud";

type CloudContextValue = {
  configured: boolean;
  ready: boolean;
  /** Auth session known and membership lookup finished for current user. */
  membershipReady: boolean;
  user: User | null;
  session: Session | null;
  meta: CloudMeta | null;
  /** Holidays this organiser owns (empty for guests / travellers). */
  ownerTrips: OwnerTripSummary[];
  setMeta: (meta: CloudMeta | null) => void;
  selectTrip: (trip: OwnerTripSummary) => void;
  clearSelectedTrip: () => void;
  refreshOwnerTrips: () => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error?: string; needsEmailConfirm?: boolean }>;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const CloudContext = createContext<CloudContextValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [membershipReady, setMembershipReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [meta, setMetaState] = useState<CloudMeta | null>(null);
  const [ownerTrips, setOwnerTrips] = useState<OwnerTripSummary[]>([]);

  useEffect(() => {
    setMetaState(loadCloudMeta());
  }, []);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      setMembershipReady(true);
      return;
    }
    const client = createClient();
    if (!client) {
      setReady(true);
      setMembershipReady(true);
      return;
    }

    let mounted = true;
    client.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setReady(true);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  // Resolve trip access: organiser trip list + optional selection, or email-only device session
  useEffect(() => {
    if (!ready) return;
    if (!configured) {
      setMembershipReady(true);
      return;
    }

    if (!user) {
      setOwnerTrips([]);
      const cached = loadCloudMeta();
      if (isEmailAccessMeta(cached)) {
        setMetaState(cached);
      } else {
        setMetaState(null);
        saveCloudMeta(null);
      }
      setMembershipReady(true);
      return;
    }

    let cancelled = false;
    setMembershipReady(false);
    const client = createClient();
    if (!client) {
      setMembershipReady(true);
      return;
    }

    void (async () => {
      // Claim legacy email-only organiser trip into trip_members if needed
      await claimOrganiserByEmail(client);
      if (cancelled) return;

      const { trips } = await fetchMyOwnerTrips(client);
      if (cancelled) return;
      setOwnerTrips(trips);

      const cached = loadCloudMeta();

      // Traveller auth membership (rare) — keep single-trip access
      if (cached?.role === "traveller" || (!trips.length && cached?.role !== "owner")) {
        const traveller = await fetchMyTravellerMembership(client);
        if (cancelled) return;
        if (traveller?.tripId && traveller.inviteCode) {
          const next: CloudMeta = {
            tripId: traveller.tripId,
            inviteCode: traveller.inviteCode,
            role: "traveller",
            personId: traveller.personId,
          };
          saveCloudMeta(next);
          setMetaState(next);
          setMembershipReady(true);
          return;
        }
      }

      // Restore previous holiday selection if still owned
      if (
        cached?.tripId &&
        cached.role !== "traveller" &&
        trips.some((t) => t.tripId === cached.tripId)
      ) {
        const hit = trips.find((t) => t.tripId === cached.tripId)!;
        const next: CloudMeta = {
          tripId: hit.tripId,
          inviteCode: hit.inviteCode,
          role: "owner",
          personId: hit.personId ?? cached.personId,
        };
        saveCloudMeta(next);
        setMetaState(next);
      } else {
        // No selection — organiser sees the holiday list on Home
        setMetaState(null);
        saveCloudMeta(null);
      }
      setMembershipReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, configured, user?.id]);

  const setMeta = useCallback((next: CloudMeta | null) => {
    saveCloudMeta(next);
    setMetaState(next);
  }, []);

  const selectTrip = useCallback((trip: OwnerTripSummary) => {
    const next: CloudMeta = {
      tripId: trip.tripId,
      inviteCode: trip.inviteCode,
      role: "owner",
      personId: trip.personId,
    };
    saveCloudMeta(next);
    setMetaState(next);
  }, []);

  const clearSelectedTrip = useCallback(() => {
    clearTrip();
    saveCloudMeta(null);
    setMetaState(null);
  }, []);

  const refreshOwnerTrips = useCallback(async () => {
    const client = createClient();
    if (!client || !user) {
      setOwnerTrips([]);
      return;
    }
    const { trips } = await fetchMyOwnerTrips(client);
    setOwnerTrips(trips);
  }, [user]);

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const client = createClient();
    if (!client) return { error: "Supabase is not configured." };
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) return { error: "Enter a valid email." };
    if (password.length < 6) return { error: "Password must be at least 6 characters." };

    const { data, error } = await client.auth.signUp({
      email: trimmed,
      password,
    });
    if (error) return { error: error.message };
    if (!data.session) {
      return {
        needsEmailConfirm: true,
        error:
          "Account created — confirm your email if Supabase requires it, then sign in. Or disable Confirm email in Auth settings.",
      };
    }
    return {};
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const client = createClient();
    if (!client) return { error: "Supabase is not configured." };
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) return { error: "Enter a valid email." };
    if (!password) return { error: "Enter your password." };

    const { error } = await client.auth.signInWithPassword({
      email: trimmed,
      password,
    });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    setOwnerTrips([]);
    setMetaState(null);
    saveCloudMeta(null);
    clearTrip();
    const client = createClient();
    if (client) await client.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      configured,
      ready,
      membershipReady,
      user,
      session,
      meta,
      ownerTrips,
      setMeta,
      selectTrip,
      clearSelectedTrip,
      refreshOwnerTrips,
      signUpWithPassword,
      signInWithPassword,
      signOut,
    }),
    [
      configured,
      ready,
      membershipReady,
      user,
      session,
      meta,
      ownerTrips,
      setMeta,
      selectTrip,
      clearSelectedTrip,
      refreshOwnerTrips,
      signUpWithPassword,
      signInWithPassword,
      signOut,
    ],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud() {
  const ctx = useContext(CloudContext);
  if (!ctx) throw new Error("useCloud must be used within CloudProvider");
  return ctx;
}
