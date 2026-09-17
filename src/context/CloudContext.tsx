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
import { loadCloudMeta, saveCloudMeta, type CloudMeta } from "@/lib/cloudMeta";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type CloudContextValue = {
  configured: boolean;
  ready: boolean;
  user: User | null;
  session: Session | null;
  meta: CloudMeta | null;
  setMeta: (meta: CloudMeta | null) => void;
  signInWithEmail: (email: string, redirectTo?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const CloudContext = createContext<CloudContextValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [meta, setMetaState] = useState<CloudMeta | null>(null);

  useEffect(() => {
    setMetaState(loadCloudMeta());
  }, []);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    const client = createClient();
    if (!client) {
      setReady(true);
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

  const setMeta = useCallback((next: CloudMeta | null) => {
    saveCloudMeta(next);
    setMetaState(next);
  }, []);

  const signInWithEmail = useCallback(async (email: string, redirectTo?: string) => {
    const client = createClient();
    if (!client) return { error: "Supabase is not configured." };
    const next =
      redirectTo ||
      (typeof window !== "undefined" ? `${window.location.origin}/account` : undefined);
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: next },
    });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    const client = createClient();
    if (client) await client.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      configured,
      ready,
      user,
      session,
      meta,
      setMeta,
      signInWithEmail,
      signOut,
    }),
    [configured, ready, user, session, meta, setMeta, signInWithEmail, signOut],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud() {
  const ctx = useContext(CloudContext);
  if (!ctx) throw new Error("useCloud must be used within CloudProvider");
  return ctx;
}
