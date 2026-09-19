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

      // token_hash links (after custom SMTP + template edit)
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

      // Implicit flow: tokens arrive in the URL hash — give the client a moment
      await new Promise((r) => setTimeout(r, 50));
      const { data: fromHash } = await client.auth.getSession();
      if (cancelled) return;
      if (fromHash.session) {
        router.replace(next);
        return;
      }

      // Legacy PKCE ?code= (may fail if opened in a different browser)
      const code = search.get("code");
      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          const msg = exchangeError.message || "";
          if (/pkce|code verifier/i.test(msg)) {
            setError(
              "This email link opened in a different browser (common with iPhone Mail). Close this, open Trip Ready in Safari, go to Account, request a new link, then open that email’s Sign in link and stay in that window — or set up Resend SMTP later so we can use a 6-digit code.",
            );
          } else {
            setError(msg);
          }
          return;
        }
        router.replace(next);
        return;
      }

      // One more session check (hash parse can be async)
      await new Promise((r) => setTimeout(r, 200));
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        router.replace(next);
        return;
      }

      setError(
        "Sign-in didn’t complete. Open Account in Safari, request a new email, tap Sign in in that email, and stay in the browser that opens.",
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
