import { Suspense } from "react";
import { JoinPage } from "@/components/JoinPage";

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
      <JoinPage />
    </Suspense>
  );
}
