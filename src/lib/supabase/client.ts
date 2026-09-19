import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()),
  );
}

export function createClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) return null;
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      // Implicit: magic links work when opened from iPhone Mail (different browser
      // than where the email was requested). PKCE fails with "code verifier not found".
      // Templates can't be edited without custom SMTP, so we can't rely on {{ .Token }}.
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
