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
  const [hint, setHint] = useState<string | null>(null);

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

      // Implicit flow puts tokens in the hash (#access_token=…)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 75));
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          router.replace(next);
          return;
        }
        // Hash may still be present for detectSessionInUrl
        if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
          continue;
        }
      }

      const code = search.get("code");
      if (code) {
        // Old PKCE emails still in inbox — try exchange, then explain
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (!exchangeError) {
          router.replace(next);
          return;
        }
        setError("This sign-in email is an older link type.");
        setHint(
          "On your phone: open Trip Ready in Safari → Account → Email me a link → in Mail, long-press Sign in → Open in Safari. Or sign in once on your computer and leave that tab open for the trip.",
        );
        return;
      }

      setError("Sign-in didn’t finish.");
      setHint(
        "Request a new email from Account after the app updates, then tap Sign in and stay in the window that opens.",
      );
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
          {hint ? <p className="muted">{hint}</p> : null}
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Link href="/account" className="btn btn-primary">
            Back to Account
          </Link>
        </div>
        <p className="muted" style={{ margin: "1rem 0 0" }}>
          Tip: in this Mail browser, tap the <strong>compass</strong> icon to open in
          Safari — only works if you also requested the link from Safari.
        </p>
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
