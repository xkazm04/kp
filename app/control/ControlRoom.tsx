"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useLoader } from "@/app/_lib/useLoader";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
import { pollDelayMs } from "@/app/_lib/task-poll-state";
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
export function ControlRoom({ canGovern, canOperate }: { canGovern: boolean; canOperate: boolean }) {
  const t = useTranslations("control");
  // Resolve an API failure from the machine `code`, never from the server's English
  // `error` string (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const [busy, setBusy] = useState(false);
  // What the LAST consequential POST answered. Until this wave the three mutations here
  // were fire-and-forget: a refused approve or a 403 read as success and the row simply
  // reappeared on the next 3s poll, which looks like the click never landed.
  const [actErr, setActErr] = useState<string | null>(null);
  const [sweep, setSweep] = useState<{ resumed: number; budgetExhausted: boolean } | null>(null);
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
  // The poll used to be a flat 3s window.setInterval over BOTH doors, running in a
  // hidden tab and against a dead server alike: 40 requests a minute per open tab,
  // forever. It now rides the tasks dock's schedule (app/_lib/task-poll-state.ts) -
  // 2s while something is in flight, 6s idle, and 4s/8s/16s/32s/60s after consecutive
  // failures - and skips the fetch entirely while the document is hidden.
  const failures = useRef(0);
  const anyActive = useRef(false);
  const lastStatus = useRef(sState);
  useEffect(() => {
    // One tick = one identity change on the status loader's state (useLoader replaces
    // the object on every attempt, success or failure), so this counts polls, not
    // renders. A success resets the run; a failure lengthens the next delay.
    if (sState === lastStatus.current) return;
    lastStatus.current = sState;
    failures.current = sState.failed ? failures.current + 1 : 0;
  }, [sState]);
  useEffect(() => {
    // Something to watch move: a lifecycle mid-walk or a gate waiting on this operator.
    anyActive.current = (s?.lifecycles ?? []).some((l) => !["promoted", "closed"].includes(l.stage));
  }, [s]);
  useEffect(() => {
    let cancelled = false;
    let timeout: number;
    const tick = async () => {
      await load();
      await loadOutcomes();
    };
    const loop = (delay: number) => {
      if (cancelled) return;
      timeout = window.setTimeout(async () => {
        if (!document.hidden) await tick();
        loop(pollDelayMs(anyActive.current, failures.current));
      }, delay);
    };
    loop(0);
    // A reader coming back to the tab wants the room live NOW, not on the next tick.
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
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

  // READ THE ANSWER. Every branch of this handler ends in a rendered outcome: a coded
  // refusal in the reader's language, the sweep's own numbers, or a cleared banner.
  const act = async (action: string) => {
    setBusy(true);
    setActErr(null);
    setSweep(null);
    try {
      const r = await fetch("/api/devcase/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const p = (await r.json().catch(() => null)) as
        | { error?: string; code?: string; capability?: string; resumed?: number; budgetExhausted?: boolean }
        | null;
      if (!r.ok) {
        // capabilityAwareReason names the PERMISSION on a 403, so a stale tab whose
        // buttons predate a role change says what to ask for, not just "no".
        setActErr(capabilityAwareReason(errMsg, p, t("actionFailed", { status: r.status })));
        return;
      }
      // `resumed` / `budgetExhausted` were on the wire from the day the sweep was
      // budgeted and nothing ever looked at them, so a truncated sweep - the case the
      // route went out of its way to report honestly - was indistinguishable from a
      // complete one.
      if (typeof p?.resumed === "number") setSweep({ resumed: p.resumed, budgetExhausted: p.budgetExhausted === true });
    } catch {
      setActErr(t("actionNetwork"));
    } finally {
      setBusy(false);
      await load();
    }
  };
  const approve = async (id: string) => {
    setBusy(true);
    setActErr(null);
    setSweep(null);
    try {
      const r = await fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string; capability?: string; stage?: string } | null;
      // A refused approve NAMES why: the 409 carries the stage the lifecycle actually
      // sits at (someone else signed off, or the tab is stale), the 403 names the
      // capability, the 422 the probe verdict. Without this the row simply reappeared on
      // the next poll and the operator had no way to tell a refusal from a lost click.
      if (!r.ok) setActErr(capabilityAwareReason(errMsg, p, t("approveFailed", { status: r.status })));
    } catch {
      setActErr(t("approveNetwork"));
    } finally {
      setBusy(false);
      await load();
    }
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
            <p className={EYEBROW}>{t("eyebrow")}</p>
            <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
            <p className={`mt-1 max-w-2xl ${INTRO}`}>{t("intro")}</p>
          </div>
          <Link href="/?tab=assignments" className="focus-ring rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-coral/40">
            {t("backToDevCases")}
          </Link>
        </header>

        {/* LoadStatus composes its own English sentence around `label` (it is a
            shared primitive that has not been migrated yet), so passing a localized
            fragment here would produce a half-translated banner. English until that
            component takes a catalog. */}
        <LoadStatus state={roomState} label="the control room" className="mt-4" />

        {actErr ? (
          <p role="alert" className="mt-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-micro font-semibold text-coral">
            {actErr}
          </p>
        ) : null}
        {sweep ? (
          <p role="status" className="mt-3 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-micro text-ink">
            {t("sweep.resumed", { count: sweep.resumed })}
            {sweep.budgetExhausted ? ` ${t("sweep.budgetExhausted")}` : ""}
          </p>
        ) : null}

        <AutonomyBar
          paused={s?.autonomy === "paused"}
          busy={busy}
          armed={armed}
          onAct={act}
          guard={guard}
          canGovern={canGovern}
          canOperate={canOperate}
        />
        {/* The gate queue is an ACTION queue and nothing else: a seat that cannot approve
            is shown the same lifecycles in the list below, without a button that can only
            ever 403 at them. */}
        {canOperate ? <GatesPanel gates={s?.pendingGates ?? []} armed={armed} guard={guard} onApprove={approve} /> : null}
        <AuditPanel lifecycles={active} audit={s?.audit ?? []} />
        <CalibrationPanel data={o} armed={armed} guard={guard} reload={reloadAll} canGovern={canGovern} canOperate={canOperate} />
      </div>
    </div>
  );
}
