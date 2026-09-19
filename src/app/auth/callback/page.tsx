"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

      const code = search.get("code");
      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      } else {
        // Older links / already exchanged — check session
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          setError("Sign-in link expired or already used. Request a new one from Account.");
          return;
        }
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
