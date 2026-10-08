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
      const nextRaw = search.get("next") || "/";
      const next = nextRaw.startsWith("/") ? nextRaw : "/";
      const client = createClient();
      if (!client) {
        setError("Cloud is not configured.");
        return;
      }

      // Email-confirm / recovery links (if Confirm email is on)
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

      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 75));
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          router.replace(next);
          return;
        }
        if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
          continue;
        }
      }

      setError("Sign-in didn’t finish. Use email and password on Account.");
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
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Signing you in…</h2>
        <p>You’ll land in Trip Ready in a moment.</p>
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
