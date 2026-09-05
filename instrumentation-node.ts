// Node-only instrumentation body. Imported ONLY from instrumentation.ts, behind
// the `process.env.NEXT_RUNTIME === "nodejs"` guard, so this module's SQLite /
// native imports (better-sqlite3, reached via the stores) never enter a non-Node
// compile of the instrumentation hook. Next replaces NEXT_RUNTIME with a build
// constant per target, so the edge/client build folds the guard to `false` and
// tree-shakes this whole import away — which is what stops the bundler from
// chasing better-sqlite3 → bindings → `fs` (no `fs` off-Node). better-sqlite3 is
// also pinned in serverExternalPackages (next.config.ts) for the Node bundle.
//
// SCHEDULER_TICK_MS is imported statically (scheduler-health.ts is a pure, native-
// free leaf module — safe for the edge/client tree-shake) so the clock's cadence
// and the liveness staleness threshold share ONE source and can never drift.
import { SCHEDULER_TICK_MS } from "./app/_lib/scheduler-health.ts";

// --- The stop control (EU AI-Act pack G15, Art. 14(4)(e)) --------------------
// The Control Room's autonomy pause is presented to the operator as "Pause to halt
// all automation immediately" (`control.autonomy.runningBody`). It used to have
// exactly ONE behavioural consumer — `devcase-orchestrator.ts` — so a paused
// deployment kept sending candidate-facing interview and offer reminders, kept
// lapsing live offers, and kept running the policy pass. During an incident that is
// the opposite of a stop control: the surface said "halted" while the clock kept
// acting on candidates. `clockIsPaused()` is what makes the button true for the
// server clock as well.
//
// SCOPE, stated deliberately rather than left to whichever module happened to
// import dev-control:
//   HALTED while paused — every DISCRETIONARY pass: the inbound pull/edge passes
//     (they file leads through the intake core, which dispatches a candidate-facing
//     acknowledgement), the policy pass, interview reminders, offer lapse, offer
//     reminders. Nothing is lost by halting them: pull cursors only advance over
//     applied events, the edge holds its log until acked, reminders re-become due,
//     and an offer's expiry is also applied lazily on the candidate's own read.
//   EXEMPT — the GDPR consent-expiry sweep (`sweepExpiredConsents` below). See the
//     reasoning on that function: it is a statutory retention duty, not an
//     automated decision, and a UI toggle must not be able to suspend it.
//   ALWAYS — the liveness heartbeat, so ops can still tell a PAUSED clock from a
//     WEDGED one. A pause must not look like a crash.
let lastAutonomySeen: "on" | "paused" = "on";

async function clockIsPaused(): Promise<boolean> {
  // FAIL CLOSED. Every gated sweep below needs the same SQLite file this read
  // needs, so a read failure means no sweep could do useful work anyway — and a
  // stop control that silently keeps going when it cannot read its own flag is not
  // a stop control. Self-healing: the next tick re-reads.
  let paused = true;
  try {
    const { getAutonomy } = await import("./app/_lib/dev-control");
    paused = getAutonomy() === "paused";
  } catch (e) {
    console.error("[clock] autonomy read failed — halting this tick (fail closed):", e);
  }
  const state: "on" | "paused" = paused ? "paused" : "on";
  // Audit the TRANSITION only. At a 1-minute cadence a row per tick would bury the
  // dev_audit chain that Art. 12 record-keeping leans on.
  if (state !== lastAutonomySeen) {
    lastAutonomySeen = state;
    try {
      const { recordAudit } = await import("./app/_lib/dev-control");
      recordAudit({
        actor: "system",
        action: paused ? "clock_halted" : "clock_resumed",
        reason: paused
          ? "autonomy paused — the clock's discretionary passes are skipped (the statutory consent-expiry sweep keeps running)"
          : "autonomy on — the clock's discretionary passes resume",
      });
    } catch {
      /* the audit must never break the clock */
    }
  }
  return paused;
}

/** GDPR consent-expiry sweep (consent.ts) — independent, best-effort, idempotent.
 *  Anonymizes candidates whose data-processing consent has lapsed (PII scrubbed,
 *  scores/notes/stage retained for re-engagement). The candidate erasure path also
 *  anonymizes on demand; this sweep is what honors a silent expiry on time.
 *
 *  DELIBERATELY EXEMPT from the autonomy pause, and the reasoning is the decision
 *  itself rather than an accident of imports: this is not an automated DECISION about
 *  a candidate (the Art. 14 oversight surface governs those), it is the execution of a
 *  statutory retention duty — storage limitation (GDPR Art. 5(1)(e)) once the lawful
 *  basis has lapsed. Continuing to hold identifiable data past consent expiry is the
 *  unlawful state, so a UI toggle that suspends the scrub would let an operator park
 *  the deployment in it indefinitely, with no record that they had. The sweep also
 *  destroys nothing a human decision needs: it de-identifies, keeping stage/score/
 *  notes. If a future erasure-hold ("legal hold") capability is added, it belongs on
 *  the consent record where it can be per-candidate and audited — not on this pause. */
async function sweepExpiredConsents(): Promise<void> {
  try {
    const { anonymizeExpiredConsents } = await import("./app/_lib/db");
    const anonymized = anonymizeExpiredConsents();
    if (anonymized) console.log("[clock] consents expired → anonymized:", anonymized);
  } catch (e) {
    console.error("[clock] consent anonymization sweep failed:", e);
  }
}

export async function startClock(): Promise<void> {
  const g = globalThis as typeof globalThis & { __kpClockStarted?: boolean };
  if (g.__kpClockStarted) return; // guard against duplicate intervals across HMR
  g.__kpClockStarted = true;

  // Eager recovery: the in-process task queue is volatile, but the `tasks` rows
  // are the source of truth, so promptly mark any 'running' row a previous process
  // left mid-flight as 'interrupted'. Never-started 'queued' rows are intentionally
  // left for the task runner (ensureRecovered) to re-enqueue on first read rather
  // than abandoned — that path owns the in-process queue and resumes the work.
  try {
    const { interruptStaleTasks } = await import("./app/_lib/db");
    interruptStaleTasks();
  } catch (e) {
    console.error("[clock] task recovery failed:", e);
  }

  const HEARTBEAT_MS = SCHEDULER_TICK_MS;
  const tick = async () => {
    // Liveness heartbeat FIRST, before any sweep: stamp last_tick_at each tick so
    // the ops/health surface can tell a LIVE clock from a wedged one
    // (scheduler-health.schedulerLiveness). Recording it up front means even a tick
    // whose sweeps throw still proves the self-rescheduling chain is running — a
    // DEAD chain is exactly what stops updating this row. A single UPSERT on the
    // one-row scheduler_heartbeat table (created in db/core.ts).
    try {
      const { ensureDb } = await import("./app/_lib/db");
      ensureDb()
        .prepare(
          `INSERT INTO scheduler_heartbeat (id, last_tick_at) VALUES ('clock', ?)
             ON CONFLICT(id) DO UPDATE SET last_tick_at = excluded.last_tick_at`
        )
        .run(new Date().toISOString());
    } catch (e) {
      console.error("[clock] heartbeat write failed:", e);
    }
    // THE STOP CONTROL (G15). Placed after the heartbeat so a paused clock still
    // proves it is alive, and before every discretionary pass so "paused" means the
    // machine stops ACTING — no policy advance, no candidate-facing send, no lead
    // filed — rather than merely stopping the case-lifecycle orchestrator. The
    // statutory consent sweep is the one documented exemption; see its definition.
    if (await clockIsPaused()) {
      await sweepExpiredConsents();
      return;
    }
    // COLLECT BEFORE YOU DECIDE (docs/concepts/local-first-edge.md): both inbound
    // sweeps run BEFORE the policy pass, so a lead that arrived while this machine
    // was off is already filed when the pass looks at the pipeline — instead of
    // waiting a whole cadence to be seen. Independent and best-effort, like every
    // other sweep here: a source that is down cannot stop the clock.
    //
    // L0 — pull the sources that can be listed. Costs nothing and needs no cloud.
    try {
      const { runPullPass } = await import("./app/_lib/pull-pass");
      const pulled = await runPullPass();
      if (pulled.applied || pulled.failed) {
        console.log("[clock] pull pass:", JSON.stringify({ applied: pulled.applied, rejected: pulled.rejected, failed: pulled.failed }));
      }
    } catch (e) {
      console.error("[clock] pull pass failed:", e);
    }
    // L1 — drain the edge that answered for us while we were down, then tell it we
    // are awake. The heartbeat is sent whether or not anything drained: it is what
    // keeps the "your studio has mail" nudge quiet while the studio is open.
    try {
      const { drainEdge, sendEdgeHeartbeat } = await import("./app/_lib/edge-drain");
      const drained = await drainEdge();
      if (drained.configured) {
        if (drained.applied || drained.error) {
          console.log("[clock] edge drain:", JSON.stringify({ applied: drained.applied, skipped: drained.skipped, cursor: drained.cursor, error: drained.error }));
        }
        await sendEdgeHeartbeat();
      }
    } catch (e) {
      console.error("[clock] edge drain failed:", e);
    }
    try {
      const { tickScheduler } = await import("./app/_lib/scheduler");
      const r = await tickScheduler();
      if (r.ran && !r.error) console.log("[clock] policy pass ran:", JSON.stringify(r.summary));
      else if (r.error) console.error("[clock] policy pass error:", r.error);
    } catch (e) {
      console.error("[clock] tick failed:", e);
    }
    // Interview reminders — independent of the policy schedule (time-sensitive,
    // no auto-advance opt-in required) but, since AUTO6, a REGISTERED scheduler
    // job: claimDueRun gates the sweep (its row defaults ON at the historical
    // every-minute cadence, and pausing it from the UI actually pauses sends),
    // last_run_at proves the sweep is alive, and sends/failures land in
    // scheduler_runs instead of living only in server logs. Zero-send sweeps
    // record no run row — at a 1-minute cadence that would be pure noise.
    try {
      const { ensureReminderJob, claimDueRun, recordRun, REMINDERS_JOB } = await import("./app/_lib/scheduler-store");
      ensureReminderJob();
      if (claimDueRun(REMINDERS_JOB)) {
        const startedAt = new Date().toISOString();
        try {
          const { sendDueInterviewReminders } = await import("./app/_lib/interview-reminders");
          const n = await sendDueInterviewReminders();
          if (n) {
            recordRun({ job: REMINDERS_JOB, status: "ok", summary: { sent: n }, startedAt });
            console.log("[clock] interview reminders sent:", n);
          }
        } catch (e) {
          recordRun({
            job: REMINDERS_JOB,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            startedAt,
          });
          console.error("[clock] reminder sweep failed:", e);
        }
      }
    } catch (e) {
      console.error("[clock] reminder job bookkeeping failed:", e);
    }
    // Lapse expired offers (idea-29361408) — independent, best-effort, idempotent.
    // The candidate read/respond paths also lazily lapse on access; this sweep is
    // what flips an un-opened offer to 'expired' on the recruiter board on time.
    try {
      const { lapseExpiredOffers } = await import("./app/_lib/offers-store");
      const lapsed = lapseExpiredOffers();
      if (lapsed) console.log("[clock] offers lapsed (expired):", lapsed);
    } catch (e) {
      console.error("[clock] offer lapse sweep failed:", e);
    }
    // Proactive offer-expiry reminders (idea-29361408 follow-up) — the heads-up sent at
    // T-48h before the lapse above, so a candidate who forgot doesn't lose a live offer
    // to silence. Independent, best-effort, at-most-once (the sweep CAS-claims
    // reminded_at before dispatch, so a re-tick can't double-send a candidate-facing nudge).
    try {
      const { sendDueOfferReminders } = await import("./app/_lib/offer-reminders");
      const reminded = await sendDueOfferReminders();
      if (reminded) console.log("[clock] offer reminders sent:", reminded);
    } catch (e) {
      console.error("[clock] offer reminder sweep failed:", e);
    }
    // Price drift (billing) — the ONE daily pass here, registered as a scheduler job
    // beside the reminders one so it shares their bookkeeping: claimDueRun gates it to
    // a single run per cadence (and survives restarts), and scheduler_runs records what
    // it found instead of leaving it in server logs. The invariant it guards is "the
    // price the catalog DISPLAYS equals the price the provider CHARGES", which until
    // now was checked only by a setup script an operator runs once — i.e. never again
    // after the dashboard edit that introduces the drift.
    //
    // Sits UNDER the autonomy pause with the other discretionary passes: it is an
    // outbound provider read on a timer, and a stop control that leaves egress running
    // is not one. Self-safe besides — runPriceReconcile answers `skipped` when billing
    // is unconfigured or KP_OFFLINE is set, so a self-hosted install does nothing.
    try {
      const { ensureSchedule, claimDueRun, recordRun } = await import("./app/_lib/scheduler-store");
      const PRICE_RECONCILE_JOB = "price_reconcile";
      // Daily. The drift it looks for is a human dashboard edit, not an event — hourly
      // would spend provider quota to learn the same thing 23 more times.
      ensureSchedule(PRICE_RECONCILE_JOB, { enabled: true, intervalMinutes: 24 * 60 });
      if (claimDueRun(PRICE_RECONCILE_JOB)) {
        const startedAt = new Date().toISOString();
        try {
          const { runPriceReconcile } = await import("./app/_lib/billing/sync");
          const r = await runPriceReconcile();
          // A skipped run (no provider configured) records nothing: at a daily cadence
          // that would be a row a day saying "billing is off" on every self-host.
          if (!r.skipped) recordRun({ job: PRICE_RECONCILE_JOB, status: "ok", summary: r, startedAt });
        } catch (e) {
          recordRun({
            job: PRICE_RECONCILE_JOB,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            startedAt,
          });
          console.error("[clock] price reconcile failed:", e);
        }
      }
    } catch (e) {
      console.error("[clock] price reconcile bookkeeping failed:", e);
    }
    // Provider-event payload retention (db/billing.ts) — independent, best-effort,
    // idempotent, and placed beside the reconcile job because it is the other standing
    // duty on the billing tables. `billing_events` had no retention anywhere in the
    // tree: the ROW is the idempotency gate and must be kept forever, but the verbatim
    // provider body stored beside it — a customer id, an email on some Polar shapes,
    // the whole product/price object — was kept forever too, in a table whose size an
    // external system decides. This blanks payloads past the store's stated window and
    // leaves every row (and therefore every dedupe) intact.
    //
    // Sits UNDER the autonomy pause with the sweeps below it: storage hygiene on our
    // own bookkeeping, not a statutory duty, so a halted machine does as little as it can.
    try {
      const { pruneBillingEventPayloads } = await import("./app/_lib/db/billing");
      const blanked = pruneBillingEventPayloads();
      if (blanked) console.log("[clock] billing event payloads aged out:", blanked);
    } catch (e) {
      console.error("[clock] billing payload retention sweep failed:", e);
    }
    // Apply-funnel retention (apply-session-store.ts) — independent, best-effort,
    // idempotent. `apply_sessions` is written from a PUBLIC door on every form open
    // and had no delete anywhere in the tree, so the abandoned attempts (the
    // majority, by construction) accrued forever. This drops the orphans past the
    // store's stated window; rows that reached a filed entry are provenance and are
    // never touched.
    //
    // Sits UNDER the autonomy pause, unlike the consent sweep below it: this is
    // storage hygiene on our own bookkeeping, not a statutory duty about a
    // candidate's identifiable data, so nothing goes unlawful while an operator has
    // the machine halted and a paused clock should do as little as it can.
    try {
      const { sweepAbandonedApplySessions } = await import("./app/_lib/apply-session-store");
      const swept = sweepAbandonedApplySessions();
      if (swept) console.log("[clock] abandoned apply attempts swept:", swept);
    } catch (e) {
      console.error("[clock] apply-session retention sweep failed:", e);
    }
    // Rediscovery-alert retention (rediscovery-alert-store.ts) — independent,
    // best-effort, idempotent. `rediscovery_alerts` likewise had no delete anywhere:
    // dismissed rows are kept deliberately (the UNIQUE index is what makes dismissal
    // sticky) and un-acted-on ones simply accrued, each carrying a candidate's NAME
    // for a re-contact that never happened. This drops both past the store's stated
    // windows. Sits beside the apply-session sweep and UNDER the autonomy pause for
    // the same reason: it is storage hygiene on our own bookkeeping, and a paused
    // machine should do as little as it can.
    try {
      const { pruneRediscoveryAlerts } = await import("./app/_lib/rediscovery-alert-store");
      const { dismissed, stale } = pruneRediscoveryAlerts();
      if (dismissed || stale) {
        console.log(`[clock] rediscovery alerts pruned: ${dismissed} dismissed, ${stale} stale`);
      }
    } catch (e) {
      console.error("[clock] rediscovery-alert retention sweep failed:", e);
    }
    // ATS delivery-ledger retention (ats-delivery-store.ts) — independent, best-effort,
    // idempotent. `ats_delivery` had no delete either: one row per mirrored lifecycle
    // event, each naming a candidate's pipeline entry, kept forever to answer a question
    // ("did this hire reach the HRIS?") that stops being asked within days. Only TERMINAL
    // rows go — delivered, or dead-lettered with no retry scheduled — so live retry work
    // is never swept out from under the sweep beside it. Same placement and same reason
    // as the two above: storage hygiene on our own bookkeeping, under the autonomy pause.
    try {
      const { pruneAtsDeliveries } = await import("./app/_lib/ats-delivery-store");
      const pruned = pruneAtsDeliveries();
      if (pruned) console.log("[clock] ATS delivery ledger pruned:", pruned);
    } catch (e) {
      console.error("[clock] ATS delivery retention sweep failed:", e);
    }
    // GDPR consent-expiry sweep — runs in BOTH states; see sweepExpiredConsents.
    await sweepExpiredConsents();
  };

  // Self-rescheduling chain instead of setInterval: arm the NEXT tick only AFTER the
  // current one fully settles, so a slow run (slow LLM calls, or SQLite contention
  // where busy_timeout makes a writer wait up to 5s) can never overlap the next and
  // re-enter the scheduler + reminder sweep concurrently — two overlapping sweeps
  // could both read the same due reminders and double-send candidate-facing messages.
  const armNext = (delay: number) => {
    const handle = setTimeout(runTick, delay);
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      (handle as { unref: () => void }).unref(); // never keep the process alive for the clock alone
    }
  };
  const runTick = async () => {
    try {
      await tick();
    } finally {
      armNext(HEARTBEAT_MS); // only re-arm once this tick has resolved
    }
  };

  armNext(8_000); // let the server finish booting before the first tick
}
