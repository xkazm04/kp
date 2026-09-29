#!/usr/bin/env node
/**
 * e2e-live - the gig lifecycle END TO END against the REAL Personas and REAL models, on ONE
 * small, safe fixture gig this run creates (docs/features/gigs/README.md "Testing the process
 * end to end", tier 2). The hermetic twin is e2e/gig-lifecycle.spec.ts (tier 1).
 *
 * IT SPENDS MONEY: three plan seats (Fable 5, Opus 5.5 at xhigh, Sonnet 5.5 at high), the
 * research brief (Sonnet 5.5 with web research) and one gig persona run (Opus 5.5 high,
 * UNCAPPED in Personas by the operator's 2026-09-29 decision). So it refuses to start without
 * `--i-know-this-spends`. This run is also the first MEASUREMENT of the Fable and Opus-xhigh
 * seat costs, which is why it proposes all three seats.
 *
 * Sequence (every call is kp's HTTP API; KP_BASE_URL / --kp, default http://localhost:3000):
 *   1. preflight   GET  /api/agents/bridge (paired?) + the shared-sync exposure check below
 *   2. forward     POST /api/gigs  - the fixture gig, created by THIS run (a 200 "already on
 *                  the desk" answer is refused: the run never adopts a gig it did not create)
 *   3. research    POST /api/gigs/<id>/research (synchronous, the pinned brief engine)
 *   4. plans       POST /api/gigs/<id>/plans -> the gig_plans task -> GET .../plans
 *   5. accept      the CHEAPEST ready plan, with a note (human gate 1, answered)
 *   6. dispatch    POST /api/gigs/<id>/dispatch -> 202 pairing pending (or 200: ran at once)
 *   7. pairing     POST /api/gigs/sync + GET /api/gigs/specialists until the gig persona's hire
 *                  is active. Personas' gig persona policy approves it on arrival (human gate
 *                  2); a hire still `pending_approval` after --hire-wait-s stops the run and
 *                  prints the policy's five bounds against what kp sent
 *   8. run         POST /api/gigs/sync every --poll-s until the gig is drafted (or the attempt
 *                  failed), at most --timeout-min
 *   9. plan status the accepted plan's goals as PLAN-STATUS.json mirrored them
 *  10. approve     POST /api/gigs/attempts/<id> approve, the arena's whole checklist ticked,
 *                  the AI-use disclosure included (human gate 3, answered)
 *  11. mark sent   POST /api/gigs/attempts/<id> mark_sent - the SIMULATED submission: kp never
 *                  submits anything; this records that the operator sent it (nothing is sent)
 *  12. outcome     POST /api/gigs/<id>/outcome accepted, note "e2e live run"
 *  13. retire      POST /api/gigs/sync, then the gig persona's hire must read `retired`
 * Then a table (step, status, duration, cost) and a JSON report under the OS temp dir
 * (<tmp>/kp-e2e-gigs-live/<runId>.json; the repo has no gitignored scratch folder).
 *
 * NEVER TOUCHES A GIG IT DID NOT CREATE. Every gig-specific call (research, plans, accept,
 * dispatch, review, outcome) names the gig this run created, and nothing is withdrawn. ONE
 * call is workspace-wide by nature: POST /api/gigs/sync runs the same pass as the clock's
 * gig_sync - it lands every in-flight run, polls every pending gig persona (and runs a paired
 * gig whose persona became active), mirrors PLAN-STATUS and retires personas whose gig ended.
 * So the preflight lists what a sync pass could move for OTHER gigs and refuses when anything
 * is exposed, unless --allow-shared-sync says the operator accepts that (it is exactly what the
 * clock job would do).
 *
 * SPEND GUARD: one gig; one plan round (no retry); the run stops before dispatch when the plan
 * round's reported total passes --max-plans-usd (default 5); the persona run itself cannot be
 * capped from kp (uncapped by decision) - after --timeout-min the script stops WAITING and says
 * the run may still be going in Personas.
 *
 * kp auth: open dev mode needs no cookie; a passworded deploy needs KP_SESSION_COOKIE (sent as
 * Cookie on every request), as for dry-run.mjs.
 *
 * Exit codes: 0 every step passed; 1 a step failed (the table says which); 2 usage (incl. the
 * missing --i-know-this-spends); 3 preflight refused (unpaired, or shared-sync exposure).
 * Node builtins only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_KP = "http://localhost:3000";
export const SESSION_COOKIE_ENV = "KP_SESSION_COOKIE";
export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, PREFLIGHT: 3 };
export const ACCEPT_NOTE = "e2e live run: keep it small and self-contained.";
export const OUTCOME_NOTE = "e2e live run";
/** The freelance arena's review checklist (app/_lib/gigs/checklists.ts GIG_CHECKLISTS.freelance). */
export const FREELANCE_CHECKLIST = ["brief_answered", "scope_honest", "no_overclaim", "deliverable_verified", "no_off_platform", "disclosure"];
/** Hire states the sync polls; terminal failures of a hire. */
const PENDING_HIRE = ["dispatched", "pending_approval", "onboarding"];
const DEAD_HIRE = ["failed", "rejected", "retired"];

export const HELP = `usage: node scripts/gigs/e2e-live.mjs --i-know-this-spends [options]

Run the whole gig lifecycle against the REAL Personas and REAL models on one small fixture
gig this run creates. Spends money (three plan seats, the brief, one uncapped persona run).

  --i-know-this-spends   required: the run spends real model money
  --kp <url>             kp base URL (default ${DEFAULT_KP}, or KP_BASE_URL)
  --timeout-min <n>      how long to wait for the persona run (default 20)
  --poll-s <n>           seconds between syncs while the run is out (default 20)
  --hire-wait-s <n>      how long a hire may stay pending_approval (default 60)
  --max-plans-usd <n>    stop before dispatch when the plan round cost more (default 5)
  --allow-shared-sync    run although a workspace-wide sync could move OTHER gigs
  --resume-gig <id>      continue a gig an EARLIER run of this script created (its title carries
                         the "(kp e2e <run>)" marker) from the pairing step on: no new gig, no
                         second brief or plan round, no second persona
  --help, -h             this text

Auth: open dev mode needs no cookie; a passworded deploy needs ${SESSION_COOKIE_ENV}.`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Parse argv. Throws on an unknown flag or a bad value. */
export function parseArgs(argv) {
  const out = { spends: false, kp: null, timeoutMin: 20, pollS: 20, hireWaitS: 60, maxPlansUsd: 5, allowSharedSync: false, help: false, resumeGig: null };
  const num = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number`);
    return n;
  };
  const numeric = { "--timeout-min": "timeoutMin", "--poll-s": "pollS", "--hire-wait-s": "hireWaitS", "--max-plans-usd": "maxPlansUsd" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--i-know-this-spends") out.spends = true;
    else if (a === "--allow-shared-sync") out.allowSharedSync = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--resume-gig") {
      if (typeof v !== "string" || v.startsWith("--")) throw new Error("--resume-gig needs a gig id");
      out.resumeGig = v;
      i++;
    } else if (a === "--kp") {
      if (typeof v !== "string" || v.startsWith("--")) throw new Error("--kp needs a value");
      out.kp = v;
      i++;
    } else if (a in numeric) {
      out[numeric[a]] = num(a, v);
      i++;
    } else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

export function resolveBaseUrl(flag, env = process.env) {
  return String(flag || env.KP_BASE_URL || DEFAULT_KP).replace(/\/+$/, "");
}

/** The fixture gig: small, safe, freelance, no external repository. Unique per run. */
export function fixtureGig(runId, now = new Date()) {
  return {
    arena: "freelance",
    url: `https://example.org/kp-e2e-live/${runId}`,
    title: `Write a Python function that validates ISO-8601 dates, with pytest tests (kp e2e ${runId})`,
    bodyText: [
      "Write one Python function, is_iso8601_date(value: str) -> bool, that returns True for a valid ISO-8601 calendar date (YYYY-MM-DD) and False otherwise.",
      "Handle leap years, month lengths and malformed input. Use only the standard library.",
      "Deliver the module and a pytest file with at least ten cases, and say how you ran the tests.",
      "Budget: 50 USD.",
    ].join("\n"),
    reward: { amount: 50, currency: "USD" },
    deadlineAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    tags: ["python", "pytest"],
  };
}

/** The ready plan with the lowest reported cost; a plan with no reported cost comes last. */
export function cheapestReadyPlan(plans) {
  const ready = (plans ?? []).filter((p) => p && p.status === "ready" && p.plan);
  if (ready.length === 0) return null;
  return [...ready].sort((a, b) => (a.costUsd ?? Number.POSITIVE_INFINITY) - (b.costUsd ?? Number.POSITIVE_INFINITY))[0];
}

/** The newest round's rows (plans come newest round first; a round shares one createdAt). */
export function latestRound(plans) {
  const rows = plans ?? [];
  if (rows.length === 0) return [];
  const newest = rows.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), rows[0].createdAt);
  return rows.filter((r) => r.createdAt === newest);
}

export function sumCosts(rows) {
  const known = rows.map((r) => r.costUsd).filter((c) => typeof c === "number");
  return known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null;
}

/**
 * What a workspace-wide sync pass could move for gigs OTHER than `ownGigId` (sync.ts): runs in
 * flight, gig personas still waiting on Personas (an activation dispatches their gig), gig
 * personas whose gig ended (retired), and niche specialists (retired once they have no open work).
 */
export function sharedSyncExposure(gigs, specialists, ownGigId = null) {
  const byId = new Map((gigs ?? []).map((g) => [g.id, g]));
  const ended = new Set(["accepted", "rejected", "declined", "withdrawn", "expired"]);
  const live = (s) => s.hire && !DEAD_HIRE.includes(s.hire.status);
  const out = { inFlight: [], pendingPersonas: [], toRetire: [], nicheSpecialists: [] };
  for (const g of gigs ?? []) if (g.id !== ownGigId && g.status === "dispatched") out.inFlight.push(g.id);
  for (const s of specialists ?? []) {
    if (!live(s)) continue;
    if (s.gigId === null) out.nicheSpecialists.push(s.id);
    else if (s.gigId !== ownGigId) {
      const gig = byId.get(s.gigId);
      if (PENDING_HIRE.includes(s.hire.status)) out.pendingPersonas.push(s.gigId);
      else if (!gig || ended.has(gig.status)) out.toRetire.push(s.gigId);
    }
  }
  return out;
}

export function exposureCount(x) {
  return x.inFlight.length + x.pendingPersonas.length + x.toRetire.length + x.nicheSpecialists.length;
}

/** The five bounds of Personas' gig persona policy (bridge doc §10.14), with what kp sends. */
export function policyBoundLines({ workdir }) {
  return [
    "Personas' gig persona policy approves a hire on arrival only when ALL hold (Settings -> API Keys -> Gig persona policy):",
    "  1. the policy is enabled",
    "  2. the request's top-level fit.kind is kp.gig-persona.v1             (kp sends it)",
    "  3. a cap, when the policy names one, is >= spec.maxBudgetUsd        (kp sends NO budget: set the policy's cap empty)",
    "  4. spec.modelProfile.model is on allowedModels                     (kp sends claude-opus-5-5)",
    `  5. placement.projectId's folder lies strictly inside rootPath      (this gig's folder: ${workdir ?? "unknown"})`,
    "kp's status poll carries no miss reason; the Personas approval card says which bound missed (\"gig persona policy did not apply: ...\").",
  ];
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "-";
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${(ms / 1000).toFixed(1)} s`;
}

function fmtUsd(v) {
  return typeof v === "number" ? `$${v.toFixed(4)}` : "-";
}

/** The verdict table, one row per step. */
export function renderTable(steps) {
  const rows = [["step", "status", "duration", "cost", "detail"], ...steps.map((s) => [s.step, s.status, fmtMs(s.ms), s.costLabel ?? fmtUsd(s.costUsd), s.detail ?? ""])];
  const widths = rows[0].map((_, i) => Math.min(60, Math.max(...rows.map((r) => String(r[i]).length))));
  const line = (r) => r.map((c, i) => String(c).slice(0, 60).padEnd(widths[i])).join("  ");
  return [line(rows[0]), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(line)].join("\n");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function kp(deps, method, routePath, body, timeoutMs = 60_000) {
  const headers = { "Content-Type": "application/json" };
  const cookie = deps.env[SESSION_COOKIE_ENV];
  if (cookie) headers.Cookie = cookie;
  const res = await deps.fetch(new URL(routePath, deps.baseUrl), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text, retryAfter: res.headers?.get?.("retry-after") ?? null };
}

/** POST /api/gigs/sync, paced: the route's limiter allows 20 calls per 10 minutes per IP, so a
 *  429 waits out the limiter (Retry-After when given, else a minute) instead of failing the run.
 *  Gives up only past `until`. */
async function syncPaced(deps, sleep, now, until) {
  for (;;) {
    const res = await kp(deps, "POST", "/api/gigs/sync", {});
    if (res.status !== 429) return res;
    const waitS = Math.min(120, Math.max(5, Number(res.retryAfter) || 60));
    if (now() + waitS * 1000 > until) return res;
    await sleep(waitS * 1000);
  }
}

class StepFailed extends Error {}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function main(argv, { env = process.env, log = console.log, err = console.error, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(String(e.message ?? e));
    err(HELP);
    return EXIT.USAGE;
  }
  if (opts.help) {
    log(HELP);
    return EXIT.OK;
  }
  if (!opts.spends) {
    err("Refusing to start: this run spends real model money (three plan seats, the brief and one uncapped persona run).");
    err("Pass --i-know-this-spends to run it. --help lists the options.");
    return EXIT.USAGE;
  }

  const deps = { env, fetch, baseUrl: resolveBaseUrl(opts.kp, env) };
  const runId = new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const steps = [];
  const report = { runId, kp: deps.baseUrl, startedAt: new Date(now()).toISOString(), gigId: null, steps, plans: [], attempt: null, verdict: null };
  let gigId = null;
  let workdir = null;

  const step = async (name, fn) => {
    const t0 = now();
    const row = { step: name, status: "running", ms: null, costUsd: null, detail: "" };
    steps.push(row);
    try {
      const out = (await fn(row)) ?? {};
      row.status = out.status ?? "ok";
      row.ms = now() - t0;
      return out;
    } catch (e) {
      row.status = "FAILED";
      row.ms = now() - t0;
      row.detail = String(e.message ?? e).slice(0, 300);
      throw e;
    }
  };
  const need = (res, what) => {
    if (!res.ok) throw new StepFailed(`${what} answered ${res.status}${res.json?.code ? ` ${res.json.code}` : ""}: ${res.text.slice(0, 200)}`);
    return res.json;
  };

  const finish = (code) => {
    report.finishedAt = new Date(now()).toISOString();
    report.exit = code;
    log("");
    log(renderTable(steps));
    if (gigId) log(`\ngig: ${gigId}${workdir ? `\nfolder: ${workdir}` : ""}`);
    try {
      const dir = path.join(os.tmpdir(), "kp-e2e-gigs-live");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${runId}.json`);
      writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
      log(`report: ${file}`);
    } catch (e) {
      err(`the report could not be written: ${String(e.message ?? e)}`);
    }
    return code;
  };

  try {
    // 1. preflight -------------------------------------------------------------------------
    await step("preflight", async (row) => {
      const bridge = need(await kp(deps, "GET", "/api/agents/bridge"), "GET /api/agents/bridge").bridge;
      if (!bridge?.paired) {
        row.detail = "kp is not paired with Personas";
        throw new StepFailed("kp is not paired with Personas: pair in Settings -> Integrations (or run scripts/gigs/dry-run.mjs --pair-only) and start again.");
      }
      const gigs = need(await kp(deps, "GET", "/api/gigs?limit=200"), "GET /api/gigs").gigs ?? [];
      const specialists = need(await kp(deps, "GET", "/api/gigs/specialists"), "GET /api/gigs/specialists").specialists ?? [];
      const exposure = sharedSyncExposure(gigs, specialists, null);
      report.sharedSyncExposure = exposure;
      const n = exposureCount(exposure);
      row.detail = `paired (${bridge.source}); shared-sync exposure ${n}`;
      if (n > 0 && !opts.allowSharedSync) {
        err("A workspace-wide sync (POST /api/gigs/sync, the clock's own pass) could move OTHER gigs:");
        err(`  runs in flight: ${exposure.inFlight.length}  gig personas pending (activation dispatches their gig): ${exposure.pendingPersonas.length}`);
        err(`  gig personas to retire: ${exposure.toRetire.length}  niche specialists (retired once idle): ${exposure.nicheSpecialists.length}`);
        err("Re-run with --allow-shared-sync to accept that (it is what the gig_sync clock job does).");
        throw new StepFailed("shared-sync exposure");
      }
      return { status: "ok" };
    });
  } catch (e) {
    if (!(e instanceof StepFailed)) err(String(e?.stack ?? e));
    return finish(EXIT.PREFLIGHT);
  }

  try {
    if (opts.resumeGig) {
      // A RESUMED run continues a gig an earlier run of this script created: its title carries
      // the fixture marker, so this can never adopt an operator's real gig. Steps 2-6 are
      // skipped - no new gig, no second brief or plan round, no second persona.
      await step("resume the earlier run's gig", async (row) => {
        const view = need(await kp(deps, "GET", `/api/gigs/${encodeURIComponent(opts.resumeGig)}`), "GET gig");
        if (!/\(kp e2e [0-9-]+\)$/.test(String(view.gig?.title ?? ""))) throw new StepFailed(`${opts.resumeGig} is not a gig this script created (no "(kp e2e <run>)" marker): refusing to touch it`);
        const plans = need(await kp(deps, "GET", `/api/gigs/${encodeURIComponent(opts.resumeGig)}/plans`), "GET plans").plans ?? [];
        const accepted = plans.find((p) => p.acceptedAt);
        if (!accepted) throw new StepFailed("that gig has no accepted plan: re-run from scratch instead");
        gigId = view.gig.id;
        workdir = view.gig.workdir ?? null;
        report.gigId = gigId;
        report.acceptedSeat = accepted.seat;
        row.detail = `${gigId} (${view.gig.status}); accepted ${accepted.seat}`;
      });
    } else {
      // 2. forward -----------------------------------------------------------------------------
      await step("forward the fixture gig", async (row) => {
        const res = await kp(deps, "POST", "/api/gigs", fixtureGig(runId, new Date(now())));
        const body = need(res, "POST /api/gigs");
        if (res.status !== 201 || body?.created !== true) throw new StepFailed("the fixture gig was already on the desk: this run only works a gig it created");
        gigId = body.gig.id;
        report.gigId = gigId;
        row.detail = `${gigId} (${body.gig.status})`;
        log(`gig ${gigId} created: ${body.gig.title}`);
        if (body.gig.status !== "qualified") throw new StepFailed(`the gig is ${body.gig.status}, not qualified (is kp paired? an unpaired install cannot qualify it)`);
      });

      // 3. research ----------------------------------------------------------------------------
      await step("research (brief)", async (row) => {
        const gig = need(await kp(deps, "POST", `/api/gigs/${gigId}/research`, {}, 6 * 60_000), "POST research").gig;
        row.detail = `${gig.brief?.source ?? "none"}${gig.brief?.fallbackReason ? ` (${gig.brief.fallbackReason})` : ""}; ${gig.brief?.challenges?.length ?? 0} challenges`;
        row.costLabel = "in llm_usage";
        if (gig.brief?.source !== "llm") throw new StepFailed(`the brief is ${gig.brief?.source ?? "missing"} (${gig.brief?.fallbackReason ?? "no reason"}): plans need a model-written brief to be worth measuring`);
      });

      // 4. plans -------------------------------------------------------------------------------
      await step("plans (three seats)", async (row) => {
        const { taskId } = need(await kp(deps, "POST", `/api/gigs/${gigId}/plans`, {}), "POST plans");
        const until = now() + 16 * 60_000;
        for (;;) {
          const task = need(await kp(deps, "GET", `/api/tasks/${encodeURIComponent(taskId)}`), "GET task").task;
          if (["succeeded", "failed", "canceled", "interrupted"].includes(task.status)) {
            if (task.status !== "succeeded") throw new StepFailed(`the gig_plans task ended ${task.status}`);
            break;
          }
          if (now() > until) throw new StepFailed("the gig_plans task did not finish in 16 minutes");
          await sleep(5_000);
        }
        const round = latestRound(need(await kp(deps, "GET", `/api/gigs/${gigId}/plans`), "GET plans").plans);
        report.plans = round.map((r) => ({ seat: r.seat, model: r.model, effort: r.effort, status: r.status, costUsd: r.costUsd, durationMs: r.durationMs, fallbackReason: r.fallbackReason }));
        for (const r of round) {
          steps.push({ step: `  seat ${r.seat} (${r.model}${r.effort ? ` ${r.effort}` : ""})`, status: r.status, ms: r.durationMs, costUsd: r.costUsd, detail: r.fallbackReason ?? `${r.plan?.steps?.length ?? 0} steps` });
        }
        row.costUsd = sumCosts(round);
        row.detail = `${round.filter((r) => r.status === "ready").length}/3 ready`;
        if (row.costUsd !== null && row.costUsd > opts.maxPlansUsd) throw new StepFailed(`the plan round cost $${row.costUsd}, over --max-plans-usd ${opts.maxPlansUsd}: stopping before dispatch`);
      });

      // 5. accept ------------------------------------------------------------------------------
      await step("accept the cheapest plan", async (row) => {
        const round = latestRound(need(await kp(deps, "GET", `/api/gigs/${gigId}/plans`), "GET plans").plans);
        const pick = cheapestReadyPlan(round);
        if (!pick) throw new StepFailed("no seat wrote a plan to accept");
        need(await kp(deps, "POST", `/api/gigs/${gigId}/plans/${pick.id}/accept`, { note: ACCEPT_NOTE }), "accept");
        report.acceptedSeat = pick.seat;
        row.detail = `${pick.seat} (${fmtUsd(pick.costUsd)}), ${pick.plan.steps.length} steps`;
      });

      // 6. dispatch ----------------------------------------------------------------------------
      await step("dispatch (pairing)", async (row) => {
        const res = await kp(deps, "POST", `/api/gigs/${gigId}/dispatch`, {});
        if (res.status === 202) row.detail = "202 pairing pending";
        else if (res.status === 200) row.detail = `200 ran at once (${res.json?.executionId ?? "?"})`;
        else need(res, "dispatch");
        const gig = need(await kp(deps, "GET", `/api/gigs/${gigId}`), "GET gig").gig;
        workdir = gig.workdir ?? null;
      });
    }

    // 7. pairing -----------------------------------------------------------------------------
    await step("pairing (Personas approval)", async (row) => {
      // An approved hire still builds in Personas (design pass, promote) before it is active.
      const until = now() + opts.timeoutMin * 60_000;
      let pendingSince = null;
      for (;;) {
        need(await syncPaced(deps, sleep, now, until), "POST sync");
        const specialists = need(await kp(deps, "GET", "/api/gigs/specialists"), "GET specialists").specialists ?? [];
        const mine = specialists.filter((s) => s.gigId === gigId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
        const status = mine?.hire?.status ?? "no_hire";
        row.detail = `hire ${status}`;
        if (status === "active") {
          report.personaId = mine.hire.personaId;
          return { status: "ok" };
        }
        if (DEAD_HIRE.includes(status)) throw new StepFailed(`the gig persona's hire is ${status}`);
        if (status === "pending_approval") {
          pendingSince ??= now();
          if (now() - pendingSince > opts.hireWaitS * 1000) {
            for (const l of policyBoundLines({ workdir })) err(l);
            throw new StepFailed(`the hire stayed pending_approval for more than ${opts.hireWaitS} s: the gig persona policy did not approve it`);
          }
        } else pendingSince = null;
        if (now() > until) throw new StepFailed(`the hire never became active (last: ${status})`);
        // Every pass is a workspace-wide sync (rate-limited, 20 / 10 min): pace it like the run.
        await sleep(opts.pollS * 1000);
      }
    });

    // 8. run ---------------------------------------------------------------------------------
    await step("persona run", async (row) => {
      const until = now() + opts.timeoutMin * 60_000;
      for (;;) {
        need(await syncPaced(deps, sleep, now, until), "POST sync");
        const view = need(await kp(deps, "GET", `/api/gigs/${gigId}`), "GET gig");
        const attempt = (view.attempts ?? [])[view.attempts.length - 1] ?? null;
        row.detail = `gig ${view.gig.status}; attempt ${attempt?.status ?? "none"}`;
        if (attempt) {
          report.attempt = { id: attempt.id, status: attempt.status, costUsd: attempt.costUsd, fallbackReason: attempt.fallbackReason };
          row.costUsd = attempt.costUsd ?? null;
        }
        if (view.gig.status === "drafted" && attempt?.status === "drafted") return { status: "ok" };
        if (attempt?.status === "failed") throw new StepFailed(`the run failed: ${attempt.fallbackReason ?? "no reason"}`);
        if (now() > until) throw new StepFailed(`no draft after ${opts.timeoutMin} min; the run may still be going in Personas (it is uncapped) - check it there`);
        await sleep(opts.pollS * 1000);
      }
    });

    // 9. plan status -------------------------------------------------------------------------
    await step("PLAN-STATUS mirrored", async (row) => {
      const accepted = (need(await kp(deps, "GET", `/api/gigs/${gigId}/plans`), "GET plans").plans ?? []).find((p) => p.acceptedAt);
      const goals = accepted?.progress?.goals ?? [];
      const moved = goals.filter((g) => g.status !== "open" || g.progress > 0).length;
      report.planStatus = { milestoneId: accepted?.progress?.milestoneId ?? null, goals };
      row.detail = `${moved}/${goals.length} goals reported; milestone ${accepted?.progress?.milestoneId ? "in Personas" : "kp only"}`;
      return { status: moved > 0 ? "ok" : "WARN" };
    });

    const attemptId = report.attempt.id;

    // 10. approve ----------------------------------------------------------------------------
    await step("approve (checklist)", async (row) => {
      const checklist = Object.fromEntries(FREELANCE_CHECKLIST.map((k) => [k, true]));
      const body = need(await kp(deps, "POST", `/api/gigs/attempts/${attemptId}`, { action: "approve", review: { checklist, note: OUTCOME_NOTE, reviewMs: 0 } }), "approve");
      row.detail = `gig ${body.gig?.status}`;
    });

    // 11. mark sent --------------------------------------------------------------------------
    await step("mark sent (simulated)", async (row) => {
      const body = need(await kp(deps, "POST", `/api/gigs/attempts/${attemptId}`, { action: "mark_sent" }), "mark_sent");
      row.detail = `gig ${body.gig?.status}; nothing left kp`;
    });

    // 12. outcome ----------------------------------------------------------------------------
    await step("outcome accepted", async (row) => {
      const body = need(await kp(deps, "POST", `/api/gigs/${gigId}/outcome`, { verdict: "accepted", feedbackText: OUTCOME_NOTE }), "outcome");
      report.verdict = { gigStatus: body.gig?.status, lessons: body.lessons?.length ?? 0 };
      row.detail = `gig ${body.gig?.status}; ${body.lessons?.length ?? 0} lesson(s) queued`;
    });

    // 13. retire -----------------------------------------------------------------------------
    await step("retire the gig persona", async (row) => {
      need(await syncPaced(deps, sleep, now, now() + 10 * 60_000), "POST sync");
      const specialists = need(await kp(deps, "GET", "/api/gigs/specialists"), "GET specialists").specialists ?? [];
      const mine = specialists.filter((s) => s.gigId === gigId);
      const statuses = mine.map((s) => s.hire?.status ?? "no_hire");
      row.detail = `hire ${statuses.join(", ") || "none"}`;
      if (!statuses.includes("retired")) throw new StepFailed(`the gig persona was not retired (${statuses.join(", ") || "none"}); Personas may have deferred it - the next sync retries`);
    });
  } catch (e) {
    if (!(e instanceof StepFailed)) err(String(e?.stack ?? e));
    return finish(EXIT.FAIL);
  }

  const personaRun = report.attempt?.costUsd ?? null;
  const plansTotal = sumCosts(report.plans ?? []);
  report.costs = { plansUsd: plansTotal, personaRunUsd: personaRun };
  log(`\ncosts: plans ${fmtUsd(plansTotal)} (per seat above), persona run ${fmtUsd(personaRun)}; the brief is in the Models tab's usage ledger`);
  return finish(EXIT.OK);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
