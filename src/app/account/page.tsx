import { Suspense } from "react";
import { AccountPage } from "@/components/AccountPage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Loading…
          </p>
        </section>
      }
    >
      <AccountPage />
    </Suspense>
  );
}
