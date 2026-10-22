"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY_LG, BTN_SECONDARY_LG, EYEBROW, INTRO, NOTICE, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

// The first-run data choice (operator triage T1). A fresh install boots empty; '/' renders
// this instead of the workspace while the choice is open (app/_lib/db/demo-seed.ts
// demoChoicePending). Both answers go to POST /api/setup/first-run and are recorded in the
// database, so the screen never comes back:
//   - Start empty          -> the empty workspace, where the setup wizard takes over;
//   - Explore with demo    -> the server seeds the demo corpus, then the seeded pipeline.
// Full page loads rather than router pushes: '/' decides server-side what to render, and
// the answer changes that decision.

type Busy = null | "empty" | "demo";
type Failure = null | "has-data" | "failed";

export function FirstRunDataChoice() {
  const t = useTranslations("firstRunData");
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure>(null);

  async function choose(choice: "empty" | "demo") {
    setBusy(choice);
    setFailure(null);
    try {
      const res = await fetch("/api/setup/first-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (res.status === 409) {
        setFailure("has-data");
        setBusy(null);
        return;
      }
      if (!res.ok) {
        setFailure("failed");
        setBusy(null);
        return;
      }
      window.location.assign(choice === "demo" ? "/?tab=pipeline" : "/");
    } catch {
      setFailure("failed");
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <section className={`${PANEL} w-full max-w-xl p-8`} aria-labelledby="first-run-data-title" data-testid="first-run-data-choice">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h1 id="first-run-data-title" className={`${TITLE_DISPLAY} mt-2`}>
          {t("title")}
        </h1>
        <p className={`${INTRO} mt-3`}>{t("intro")}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${BTN_SECONDARY_LG} w-full`}
              disabled={busy !== null}
              onClick={() => choose("empty")}
              data-testid="first-run-start-empty"
            >
              {busy === "empty" ? t("working") : t("empty.action")}
            </button>
            <p className="text-meta text-steel">{t("empty.detail")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${BTN_PRIMARY_LG} w-full`}
              disabled={busy !== null}
              onClick={() => choose("demo")}
              data-testid="first-run-explore-demo"
            >
              {busy === "demo" ? t("seeding") : t("demo.action")}
            </button>
            <p className="text-meta text-steel">{t("demo.detail")}</p>
          </div>
        </div>
        {failure ? (
          <p role="alert" className={`${NOTICE("critical")} mt-6`}>
            {failure === "has-data" ? t("errors.hasData") : t("errors.failed")}
          </p>
        ) : null}
      </section>
    </main>
  );
}
