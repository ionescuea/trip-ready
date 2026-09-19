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
  isEmailOrganiserMeta,
  isEmailTravellerMeta,
  loadCloudMeta,
  saveCloudMeta,
  type CloudMeta,
} from "@/lib/cloudMeta";
import { clearTrip } from "@/lib/storage";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { publicAppOrigin } from "@/lib/appUrl";
import { fetchMyMembership } from "@/lib/tripCloud";

type CloudContextValue = {
  configured: boolean;
  ready: boolean;
  /** Auth session known and membership lookup finished for current user. */
  membershipReady: boolean;
  user: User | null;
  session: Session | null;
  meta: CloudMeta | null;
  setMeta: (meta: CloudMeta | null) => void;
  signInWithEmail: (email: string, redirectTo?: string) => Promise<{ error?: string }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ error?: string }>;
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

  // Resolve trip access: signed-in owner/member, or email-only traveller on this device
  useEffect(() => {
    if (!ready) return;
    if (!configured) {
      setMembershipReady(true);
      return;
    }

    if (!user) {
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

    void fetchMyMembership(client).then((membership) => {
      if (cancelled) return;
      if (membership?.tripId && membership.inviteCode) {
        const next: CloudMeta = {
          tripId: membership.tripId,
          inviteCode: membership.inviteCode,
          role: membership.role,
          personId: membership.personId,
        };
        saveCloudMeta(next);
        setMetaState(next);
      } else {
        setMetaState(null);
        saveCloudMeta(null);
      }
      setMembershipReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, configured, user?.id]);

  const setMeta = useCallback((next: CloudMeta | null) => {
    saveCloudMeta(next);
    setMetaState(next);
  }, []);

  const signInWithEmail = useCallback(async (email: string, redirectTo?: string) => {
    const client = createClient();
    if (!client) return { error: "Supabase is not configured." };
    const origin = publicAppOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin) return { error: "App URL is not configured." };

    // Resolve where to land after the code exchange (path only)
    let nextPath = "/account";
    if (redirectTo) {
      if (redirectTo.startsWith("http")) {
        try {
          const u = new URL(redirectTo);
          nextPath = `${u.pathname}${u.search}` || "/account";
        } catch {
          nextPath = "/account";
        }
      } else if (redirectTo.startsWith("/")) {
        nextPath = redirectTo;
      }
    }

    // Always exchange ?code= on /auth/callback first (fixes phone Mail webviews)
    const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo },
    });
    if (error) return { error: error.message };
    return {};
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string) => {
    const client = createClient();
    if (!client) return { error: "Supabase is not configured." };
    const { error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signOut = useCallback(async () => {
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
      setMeta,
      signInWithEmail,
      verifyEmailOtp,
      signOut,
    }),
    [
      configured,
      ready,
      membershipReady,
      user,
      session,
      meta,
      setMeta,
      signInWithEmail,
      verifyEmailOtp,
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
