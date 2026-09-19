"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

function AuthCallbackInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const nextRaw = search.get("next") || "/account";
      const next = nextRaw.startsWith("/") ? nextRaw : "/account";
      const client = createClient();
      if (!client) {
        setError("Cloud is not configured.");
        return;
      }

      // Prefer token_hash (works from Mail / different browser — no PKCE verifier)
      const tokenHash = search.get("token_hash");
      const type = (search.get("type") || "email") as EmailOtpType;
      if (tokenHash) {
        const { error: otpError } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (cancelled) return;
        if (otpError) {
          setError(otpError.message);
          return;
        }
        router.replace(next);
        return;
      }

      const code = search.get("code");
      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          const msg = exchangeError.message || "";
          if (/pkce|code verifier/i.test(msg)) {
            setError(
              "This sign-in link was opened in a different browser than where you requested it (common with iPhone Mail). Go back to Account and enter the 6-digit code from the same email instead.",
            );
          } else {
            setError(msg);
          }
          return;
        }
        router.replace(next);
        return;
      }

      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setError(
          "Sign-in didn’t complete. On Account, request a code and type the 6 digits from the email (more reliable on phones than tapping the link).",
        );
        return;
      }

      router.replace(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, search]);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Couldn’t sign in</h2>
          <p>{error}</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Link href="/account" className="btn btn-primary">
            Back to Account
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Signing you in…</h2>
        <p>Stay on this page — you’ll land in Trip Ready in a moment.</p>
      </div>
    </section>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Signing you in…
          </p>
        </section>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
