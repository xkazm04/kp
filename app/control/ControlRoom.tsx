"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { useLoader } from "@/app/_lib/useLoader";
import { aggregateLoadState } from "@/app/_lib/load-state";
import { armOrExecute } from "./controlRoomConfirm";
import { AutonomyBar } from "./AutonomyBar";
import { GatesPanel } from "./GatesPanel";
import { AuditPanel } from "./AuditPanel";
import { CalibrationPanel } from "./CalibrationPanel";
import type { OutcomeData, Status } from "./types";

// The shell: it owns the two polled loaders, the autonomy/gate mutations that read
// back into `/api/devcase/control`, and the single armed-control key. Everything that
// renders lives in one of the four panels beside it.
export function ControlRoom() {
  const t = useTranslations("control");
  const [busy, setBusy] = useState(false);
  // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): the consequential control
  // currently ARMED (awaiting a confirm click) — approve/apply-floor/reconcile need a
  // deliberate two-step so a misclick on this oversight surface can't fire an
  // irreversible action. null = nothing armed. Pause/resume bypass this (kill switch).
  const [armed, setArmed] = useState<string | null>(null);

  // The 3s poll keeps the last good status/outcomes visible when the API drops
  // and tracks per-loader failure + freshness, so a stale view is flagged rather
  // than silently mistaken for a live one.
  const { data: s, state: sState, reload: load } = useLoader<Status | null>(
    "/api/devcase/control",
    (p) => p as unknown as Status,
    null,
  );
  const { data: o, state: oState, reload: loadOutcomes } = useLoader<OutcomeData | null>(
    "/api/devcase/outcomes",
    (p) => p as unknown as OutcomeData,
    null,
  );
  useEffect(() => {
    load();
    loadOutcomes();
    const t2 = window.setInterval(() => {
      load();
      loadOutcomes();
    }, 3000);
    return () => window.clearInterval(t2);
  }, [load, loadOutcomes]);

  // Either loader failing means the room may be stale; the merged state reports
  // the oldest fresh point so the banner states the most conservative age of
  // what's on screen (LoadStatus self-hides while both loaders are healthy).
  const roomState = aggregateLoadState([sState, oState]);

  // Applying a calibrated floor moves the live promote threshold, so the audit trail
  // and the outcome corpus both change — re-read both.
  const reloadAll = useCallback(async () => {
    await loadOutcomes();
    await load();
  }, [load, loadOutcomes]);

  const act = async (action: string) => {
    setBusy(true);
    try {
      await fetch("/api/devcase/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } finally {
      setBusy(false);
    }
  };
  const approve = async (id: string) => {
    await fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" });
    await load();
  };

  // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): route a consequential
  // control through the two-step gate. First click arms (button flips to "Confirm…");
  // a second click on the SAME control runs it. Any other control re-arms instead.
  const guard = (key: string, run: () => void | Promise<void>) => {
    const { execute, nextArmed } = armOrExecute(armed, key);
    setArmed(nextArmed);
    if (execute) void run();
  };

  const active = (s?.lifecycles ?? []).filter((l) => !["promoted", "closed"].includes(l.stage));

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
            <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
            <p className="mt-1 max-w-2xl text-body text-steel">{t("intro")}</p>
          </div>
          <Link href="/?tab=dev" className="focus-ring rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-coral/40">
            {t("backToDevCases")}
          </Link>
        </header>

        {/* LoadStatus composes its own English sentence around `label` (it is a
            shared primitive that has not been migrated yet), so passing a localized
            fragment here would produce a half-translated banner. English until that
            component takes a catalog. */}
        <LoadStatus state={roomState} label="the control room" className="mt-4" />

        <AutonomyBar paused={s?.autonomy === "paused"} busy={busy} armed={armed} onAct={act} guard={guard} />
        <GatesPanel gates={s?.pendingGates ?? []} armed={armed} guard={guard} onApprove={approve} />
        <AuditPanel lifecycles={active} audit={s?.audit ?? []} />
        <CalibrationPanel data={o} armed={armed} guard={guard} reload={reloadAll} />
      </div>
    </div>
  );
}
