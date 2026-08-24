#!/usr/bin/env node
// App-master mass-test driver — one scenario, end to end, unattended.
//
//   node scripts/app-master-bench/run.mjs --scenario kp-default \
//     --kp http://localhost:3101 --personas http://127.0.0.1:9420
//   node scripts/app-master-bench/run.mjs --all                    # every scenario, SERIALLY
//   node scripts/app-master-bench/run.mjs --all --stub-personas     # no Personas needed
//
// The loop it drives (kp routes on the left, Personas on the right):
//
//   preflight   GET /api/health                     GET  /health   (headlessBridge required)
//   pair        POST /api/agents/pair start+claim   POST /pair/request · GET /pair/claim
//   scan        POST /api/repo-scan → poll GET /api/repo-scan/[id]
//   intake      POST /api/intake {scanId} → POST /api/intake/[id]/dossier
//   dialog      9 × POST /api/intake/[id]/message   (the app_master slot script)
//   compose     POST /api/intake/[id]/compose-app-master
//   dispatch    POST /api/agents/dispatch {intakeId} →  POST /api/kp/persona-requests
//   activate    POST /api/agents/[id]/refresh until active
//   nights      N × (POST /api/kp/test/tick → GET /api/agents, record the backbone)
//   probation   POST /api/kp/test/tick {phases:["probation"]} → record the decision
//
// Everything lands in bench/app-master/runs/<stamp>-<scenario>/ as journal.jsonl
// (append-only, written as it happens) plus result.json (the record report.mjs
// aggregates). A phase failure exits non-zero WITH THE PHASE NAMED; a failed
// expectation is a scenario FAIL with the delta printed, never a stack trace.
//
// TWO PAIRINGS, ON PURPOSE. kp pairs with Personas to hire (its pk_ key is
// stored encrypted and never leaves the server — the driver cannot read it).
// The driver pairs SEPARATELY for its own `personas:test` key, because the test
// tick is a call the driver makes, not one kp makes. The driver's key is cached
// in the bench root so a second run does not re-pair.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Journal,
  PhaseError,
  glyph,
  humanMs,
  kpClient,
  parseArgs,
  personasClient,
  poll,
  runStamp,
  verdictBanner,
} from "./lib.mjs";
import { dialogAnswers, listScenarioFiles, loadScenarioFile, resolveScenarioPath } from "./scenarios.mjs";
import { evaluateExpectations, extractBackboneReading } from "./expectations.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BENCH_ROOT = path.join(REPO_ROOT, "bench", "app-master");

/** First value under `key` anywhere in a structure. Used for the probation
 *  decision, whose nesting inside the tick summary is Personas' to choose. */
function findFirst(node, key, guard = { n: 0 }) {
  if (guard.n++ > 5_000 || !node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && node[key] !== undefined && node[key] !== null) return node[key];
  for (const value of Object.values(node)) {
    const hit = findFirst(value, key, guard);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Status → the probation decision it implies, when the reporter named none.
 *  Lossy by construction (an `onboarding` row could be an extension or an
 *  un-started hire), so the result records that it was DERIVED. */
const STATUS_TO_DECISION = { active: "activated", onboarding: "extended", retired: "retired", rejected: "retired" };

// ─── phase helpers ──────────────────────────────────────────────────────────

async function phase(result, journal, name, body) {
  const started = Date.now();
  journal.write("phase-start", { phase: name });
  try {
    const value = await body();
    const entry = { phase: name, ok: true, ms: Date.now() - started };
    result.phases.push(entry);
    journal.write("phase-ok", entry);
    return value;
  } catch (error) {
    const entry = {
      phase: name,
      ok: false,
      ms: Date.now() - started,
      error: String(error?.message || error),
      ...(error?.detail ? { detail: error.detail } : {}),
    };
    result.phases.push(entry);
    result.errors.push(entry);
    journal.write("phase-fail", entry);
    // The PHASE is the name of this block, always — a PhaseError minted deeper
    // (by `must()`, naming a route) keeps its message and detail but is
    // re-stamped, so `failedPhase` is a phase and the exit line names one.
    throw new PhaseError(name, String(error?.message || error), error?.detail);
  }
}

/** A kp call that must succeed, or the phase fails naming the route + status. */
function must(name, res, hint = "") {
  if (res.ok) return res.json ?? {};
  const detail = res.error ? res.error : `${res.status} ${JSON.stringify(res.json ?? res.text).slice(0, 300)}`;
  throw new PhaseError(name, `${name}: ${detail}${hint ? ` — ${hint}` : ""}`, { status: res.status, body: res.json });
}

// ─── the run ────────────────────────────────────────────────────────────────

async function runScenario(scenario, opts) {
  const stamp = runStamp();
  const runDir = path.join(opts.benchRoot, "runs", `${stamp}-${scenario.name}`);
  const journal = new Journal(runDir);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runTag = Date.now().toString(36);

  let throttledMs = 0;
  const kp = kpClient(opts.kpUrl, {
    throttleWaitMs: opts.throttleWaitMs,
    onThrottle: ({ route, attempt, waitMs }) => {
      throttledMs += waitMs;
      journal.write("throttled", { route, attempt, waitMs, note: "kp rate-limited this route; waiting out its fixed window" });
    },
  });
  const personas = personasClient(opts.personasUrl, opts.personasKey ?? null);

  const result = {
    schemaVersion: 1,
    scenario: { ...scenario, file: scenario.file ?? null },
    runDir,
    startedAt,
    finishedAt: null,
    wallMs: null,
    mode: scenario.mode,
    kp: { baseUrl: kp.base, health: null },
    personas: { baseUrl: personas.base, health: null, stub: !!opts.stub },
    scan: null,
    intakeId: null,
    dialog: [],
    spec: null,
    specHighlights: null,
    populationFit: null,
    hire: null,
    nights: [],
    probation: null,
    costReportedUsd: null,
    unmeasured: [],
    phases: [],
    expectations: [],
    errors: [],
    warnings: [],
    ok: false,
    failedPhase: null,
  };

  journal.write("run-start", { scenario: scenario.name, kp: kp.base, personas: personas.base, mode: scenario.mode });

  try {
    // ── preflight ───────────────────────────────────────────────────────────
    await phase(result, journal, "preflight", async () => {
      const health = await kp.get("/api/health", undefined, { timeoutMs: 60_000 });
      if (health.status === 0) {
        throw new PhaseError("preflight", `kp is not answering at ${kp.base}: ${health.error}`);
      }
      result.kp.health = health.json;
      // A 503 is NOT fatal: an empty-DB bench server degrades on "job catalog is
      // empty", which has nothing to do with this loop. An unopenable DB is.
      if (health.json?.db !== "ok") {
        throw new PhaseError("preflight", `kp reports db: ${JSON.stringify(health.json?.db)} — the bench needs a working database`);
      }
      if (health.status === 503) {
        result.warnings.push(`kp /api/health is degraded: ${(health.json?.degradedReasons ?? []).join("; ") || "no reason given"}`);
      }
      if (scenario.mode === "keyless" && health.json?.engines?.gemini) {
        // Not a refusal: KP_OFFLINE seals the engines regardless of what keys sit
        // in the env. The real keyless gate is the per-turn `source` assertion
        // below — this is the disclosure that the env is not itself keyless.
        result.warnings.push(
          "a Gemini key is configured on the kp host — keyless honesty rests on KP_OFFLINE=1 and is asserted per dialog turn"
        );
      }

      const ph = await personas.get("/health", { timeoutMs: 30_000 });
      if (ph.status === 0) {
        throw new PhaseError("preflight", `Personas is not answering at ${personas.base}: ${ph.error}`);
      }
      result.personas.health = ph.json;
      if (ph.json?.status !== "ok" || ph.json?.management !== true) {
        throw new PhaseError("preflight", `Personas answered ${JSON.stringify(ph.json)} — the management route table is not live`);
      }
      if (ph.json?.headlessBridge !== true) {
        throw new PhaseError(
          "preflight",
          "Personas is not in headless bridge mode (health.headlessBridge is not true) — this driver cannot approve a hire by hand. Start it with PERSONAS_HEADLESS_BRIDGE=1."
        );
      }
      journal.write("preflight-ok", { kp: result.kp.health?.ok, personas: ph.json });
    });

    // ── pair ────────────────────────────────────────────────────────────────
    await phase(result, journal, "pair", async () => {
      // (1) the DRIVER's own key, for POST /api/kp/test/tick.
      let key = personas.key;
      if (key) {
        const probe = await personas.get("/api/kp/connector-catalog", { timeoutMs: 30_000 });
        if (!probe.ok) {
          journal.write("pair-key-stale", { status: probe.status });
          key = null;
        }
      }
      if (!key) {
        const nonce = randomBytes(24).toString("hex");
        const asked = await personas.post(
          "/pair/request",
          { nonce, scopes: ["personas:read", "personas:test"], client: { name: "kp app-master bench", kind: "cli" } },
          { timeoutMs: 30_000 }
        );
        if (!asked.ok) throw new PhaseError("pair", `POST /pair/request refused the driver: ${asked.status} ${asked.text.slice(0, 200)}`);
        const claimed = await poll(
          async () => {
            const res = await personas.get(`/pair/claim?nonce=${encodeURIComponent(nonce)}`, { timeoutMs: 30_000 });
            return typeof res.json?.apiKey === "string" ? res.json.apiKey : null;
          },
          { maxMs: 120_000, everyMs: 2_000, label: "the driver's pairing claim (headless mode auto-approves)" }
        );
        personas.setKey(claimed);
        key = claimed;
        if (opts.keyCacheFile) {
          mkdirSync(path.dirname(opts.keyCacheFile), { recursive: true });
          writeFileSync(
            opts.keyCacheFile,
            `${JSON.stringify({ baseUrl: personas.base, apiKey: key, pairedAt: new Date().toISOString() }, null, 2)}\n`,
            "utf8"
          );
        }
        journal.write("pair-driver", { keyPrefix: key.slice(0, 6), cached: !!opts.keyCacheFile });
      } else {
        journal.write("pair-driver", { keyPrefix: key.slice(0, 6), reused: true });
      }

      // (2) kp's OWN pairing. Its key is stored encrypted server-side; the driver
      //     can only observe whether one exists and against which base URL.
      const bridge = must("GET /api/agents/bridge", await kp.get("/api/agents/bridge"));
      const already = bridge.bridge?.paired && bridge.bridge?.baseUrl?.replace(/\/$/, "") === personas.base;
      if (already) {
        journal.write("pair-kp", { reused: true, baseUrl: bridge.bridge.baseUrl });
        return;
      }
      const started = must(
        "POST /api/agents/pair (start)",
        await kp.post("/api/agents/pair", { phase: "start", baseUrl: personas.base }),
        "kp needs KP_SECRET (or KP_ATS_SECRET_KEY) set to store the pk_ key encrypted"
      );
      const nonce = started.nonce;
      if (!nonce) throw new PhaseError("pair", "kp's pairing start returned no nonce");
      await poll(
        async () => {
          const res = await kp.post("/api/agents/pair", { phase: "claim", nonce });
          if (!res.ok) throw new PhaseError("pair", `kp's pairing claim failed: ${res.status} ${JSON.stringify(res.json)}`);
          return res.json?.paired === true;
        },
        { maxMs: 120_000, everyMs: 2_000, label: "kp's pairing claim" }
      );
      journal.write("pair-kp", { paired: true, baseUrl: personas.base });
    });

    // ── scan ────────────────────────────────────────────────────────────────
    const dossier = await phase(result, journal, "scan", async () => {
      const target = scenario.repo.rootPath ? { rootPath: scenario.repo.rootPath } : { repoUrl: scenario.repo.url };
      const started = must(
        "POST /api/repo-scan",
        await kp.post("/api/repo-scan", target),
        scenario.repo.rootPath
          ? `is KP_APP_MASTER_REPO_ROOTS set on the kp host so it admits ${scenario.repo.rootPath}?`
          : ""
      );
      const scanId = started.scanId;
      journal.write("scan-started", { scanId, target });
      const row = await poll(
        async () => {
          const res = await kp.get(`/api/repo-scan/${scanId}`);
          const scan = res.json?.scan;
          return scan && (scan.status === "complete" || scan.status === "failed") ? scan : null;
        },
        { maxMs: opts.scanTimeoutMs, everyMs: 3_000, label: `repo scan ${scanId} to finish` }
      );
      if (row.status !== "complete") {
        throw new PhaseError("scan", `the repo scan failed: ${row.error ?? "no reason recorded"}`, { scanId });
      }
      result.scan = {
        scanId,
        source: row.source,
        isLocal: row.isLocal,
        contexts: row.dossier?.size?.contexts ?? null,
        files: row.dossier?.size?.files ?? null,
        declaredGates: row.dossier?.declaredGates ?? [],
      };
      if (scenario.mode === "keyless" && row.source !== "heuristic") {
        throw new PhaseError(
          "scan",
          `a keyless run must scan by file walk, but the scan reported source "${row.source}" — is KP_OFFLINE=1 set on the kp host?`
        );
      }
      journal.write("scan-complete", result.scan);
      return { scanId, dossier: row.dossier };
    });

    // ── intake ──────────────────────────────────────────────────────────────
    await phase(result, journal, "intake", async () => {
      const created = must("POST /api/intake", await kp.post("/api/intake", { lang: "en", scanId: dossier.scanId }));
      if (created.shape !== "app_master") {
        throw new PhaseError("intake", `the session was stamped shape "${created.shape}" — a scanId should make it app_master`);
      }
      result.intakeId = created.id;
      must(
        "POST /api/intake/[id]/dossier",
        await kp.post(`/api/intake/${created.id}/dossier`, { scanId: dossier.scanId, dossier: dossier.dossier })
      );
      journal.write("intake-ready", { intakeId: created.id });
    });

    // ── dialog ──────────────────────────────────────────────────────────────
    await phase(result, journal, "dialog", async () => {
      const answers = dialogAnswers(scenario, runTag);
      for (let i = 0; i < answers.length; i++) {
        const res = await kp.post(`/api/intake/${result.intakeId}/message`, { message: answers[i] });
        const body = must(`POST /api/intake/[id]/message (turn ${i + 1})`, res);
        const turn = { turn: i + 1, answer: answers[i], source: body.source, ms: res.ms, done: !!body.done };
        result.dialog.push(turn);
        journal.write("dialog-turn", { ...turn, reply: String(body.reply ?? "").slice(0, 200) });
        if (scenario.mode === "keyless" && body.source !== "deterministic") {
          throw new PhaseError(
            "dialog",
            `turn ${i + 1} was answered by source "${body.source}" — a keyless run must run the deterministic slot script (KP_OFFLINE=1 on the kp host)`
          );
        }
      }
    });

    // ── compose ─────────────────────────────────────────────────────────────
    await phase(result, journal, "compose", async () => {
      const body = must(
        "POST /api/intake/[id]/compose-app-master",
        await kp.post(`/api/intake/${result.intakeId}/compose-app-master`)
      );
      result.spec = body.spec;
      result.populationFit = body.fit ?? null;
      result.specHighlights = {
        title: body.spec?.role?.title ?? null,
        population: body.spec?.role?.population ?? null,
        scopeRung: body.spec?.mandate?.scopeRung ?? null,
        forbiddenClasses: body.spec?.mandate?.forbiddenClasses?.length ?? null,
        approvalGates: body.spec?.mandate?.approvalGates?.length ?? null,
        budgetUsd: body.spec?.budget?.monthlyUsd ?? null,
        probationDays: body.spec?.tenure?.probationDays ?? null,
        objectives: (body.spec?.objectives ?? []).map((o) => o.kpiKey),
        coercionNotes: body.spec?.coercionNotes ?? [],
      };
      journal.write("composed", result.specHighlights);
    });

    // ── dispatch ────────────────────────────────────────────────────────────
    await phase(result, journal, "dispatch", async () => {
      const res = await kp.post("/api/agents/dispatch", { intakeId: result.intakeId });
      const body = must("POST /api/agents/dispatch", res);
      result.hire = { hiredAgentId: body.hiredAgentId, requestId: body.requestId, status: body.status };
      journal.write("dispatched", result.hire);
    });

    // ── activate ────────────────────────────────────────────────────────────
    const rosterRow = async () => {
      const roster = must("GET /api/agents", await kp.get("/api/agents"));
      return (roster.agents ?? []).find((a) => a.id === result.hire.hiredAgentId) ?? null;
    };
    await phase(result, journal, "activate", async () => {
      const seen = [];
      const row = await poll(
        async () => {
          const res = await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`);
          const status = res.json?.agent?.status ?? null;
          if (status && seen[seen.length - 1] !== status) seen.push(status);
          return status === "active" ? res.json.agent : null;
        },
        { maxMs: opts.activateTimeoutMs, everyMs: 3_000, label: "the hire to reach `active` in Personas (headless mode auto-approves)" }
      );
      result.hire.statusLadder = seen;
      result.hire.personaId = row.personaId ?? null;
      result.hire.personaName = row.personaName ?? null;
      journal.write("activated", { ladder: seen, personaId: result.hire.personaId });
    });

    // ── nights ──────────────────────────────────────────────────────────────
    await phase(result, journal, "nights", async () => {
      for (let n = 1; n <= scenario.nights; n++) {
        const t = Date.now();
        const tick = await personas.post("/api/kp/test/tick", {
          personaId: result.hire.personaId,
          phases: ["overnight", "reconcile", "report"],
        });
        const summary = tick.json?.data ?? tick.json ?? null;
        const night = { night: n, ms: Date.now() - t, tick: summary, tickOk: tick.ok, reading: {}, backbone: null, appMaster: null };
        if (!tick.ok) {
          // DEGRADE HONESTLY: a missing or refusing tick route is recorded as an
          // unmeasured night, not a driver crash. The expectation checks then
          // fail on the absence, which is the correct reading.
          night.error = tick.error ?? `${tick.status} ${tick.text.slice(0, 200)}`;
          result.unmeasured.push(`night ${n}: POST /api/kp/test/tick answered ${tick.status || "nothing"}`);
        } else {
          night.reading = extractBackboneReading(summary);
        }
        // The push report lands asynchronously; refresh, then read the roster.
        await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`).catch(() => null);
        const row = await rosterRow();
        night.backbone = row?.backbone ?? null;
        night.appMaster = row?.appMaster ?? null;
        night.agentStatus = row?.status ?? null;
        night.kpiDeltas = row?.kpiDeltas ?? null;
        if (typeof row?.aggregates?.costUsd === "number") result.costReportedUsd = row.aggregates.costUsd;
        if (!night.backbone) result.unmeasured.push(`night ${n}: no backbone was scored — nothing reported one`);
        result.nights.push(night);
        journal.write("night", {
          night: n,
          ms: night.ms,
          tickOk: tick.ok,
          verdict: night.backbone?.verdict ?? null,
          coverage: night.backbone?.coverage ?? null,
          reading: night.reading,
        });
      }
    });

    // ── probation ───────────────────────────────────────────────────────────
    await phase(result, journal, "probation", async () => {
      const before = await rosterRow();
      const tick = await personas.post("/api/kp/test/tick", {
        personaId: result.hire.personaId,
        phases: ["probation"],
      });
      const summary = tick.json?.data ?? tick.json ?? null;
      await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`).catch(() => null);
      const after = await rosterRow();
      const reported = findFirst(summary, "decision");
      const decision =
        typeof reported === "string"
          ? reported
          : after && after.status !== before?.status
            ? (STATUS_TO_DECISION[after.status] ?? null)
            : null;
      result.probation = {
        tickOk: tick.ok,
        tick: summary,
        ...(tick.ok ? {} : { error: tick.error ?? `${tick.status} ${tick.text.slice(0, 200)}` }),
        decision,
        decisionSource: typeof reported === "string" ? "reported" : decision ? "derived-from-status" : "none",
        statusBefore: before?.status ?? null,
        statusAfter: after?.status ?? null,
        backbone: after?.backbone ?? null,
      };
      if (!decision) result.unmeasured.push("probation: no decision was reported and the status did not move");
      journal.write("probation", { decision, source: result.probation.decisionSource, status: after?.status ?? null });
    });
  } catch (error) {
    result.failedPhase = error?.phase ?? "unknown";
    if (!(error instanceof PhaseError)) {
      result.errors.push({ phase: result.failedPhase, ok: false, error: String(error?.stack || error) });
    }
    journal.write("run-error", { phase: result.failedPhase, error: String(error?.message || error) });
  }

  // ── expectations ──────────────────────────────────────────────────────────
  // Evaluated even after a phase failure: what a broken run DID read is still
  // the most useful thing in the file.
  const evaluated = evaluateExpectations(scenario, result);
  result.expectations = evaluated.checks;
  result.ok = result.failedPhase === null && evaluated.ok;
  result.finishedAt = new Date().toISOString();
  result.wallMs = Date.now() - t0;
  result.throttledMs = throttledMs;
  if (throttledMs > 0) {
    result.warnings.push(
      `kp rate-limited this run for ${Math.round(throttledMs / 1000)}s in total — a sweep of several scenarios crosses the per-IP intake and repo-scan windows.`
    );
  }

  writeFileSync(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  journal.write("run-end", { ok: result.ok, failedPhase: result.failedPhase, wallMs: result.wallMs });
  return result;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function printSummary(result) {
  const banner = verdictBanner([
    `${result.scenario.name} ${result.ok ? "PASS" : "FAIL"}`,
    result.failedPhase ? `phase ${result.failedPhase} failed` : `${result.phases.length} phases`,
    `${result.nights.length} night(s)`,
    result.probation?.decision ? `probation ${result.probation.decision}` : "probation –",
    humanMs(result.wallMs),
    result.personas.stub ? "STUB Personas" : "",
  ]);
  process.stderr.write(`\n${banner}\n`);
  for (const check of result.expectations) {
    process.stderr.write(`  ${glyph(check.ok)} ${check.name}: expected ${check.expected}, got ${JSON.stringify(check.actual)} — ${check.delta}\n`);
  }
  for (const w of result.warnings) process.stderr.write(`  ! ${w}\n`);
  for (const u of result.unmeasured) process.stderr.write(`  ${glyph(null)} unmeasured — ${u}\n`);
  process.stderr.write(`  → ${result.runDir}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "App-master mass-test driver",
        "",
        "  --scenario <name|path>   one scenario (default: kp-default)",
        "  --all                    every scenario in scenarios/, SERIALLY",
        "  --kp <url>               kp base url            (default http://localhost:3101)",
        "  --personas <url>         Personas base url      (default http://127.0.0.1:9420)",
        "  --personas-key pk_…      skip the driver's own pairing",
        "  --stub-personas          run an in-process stub Personas instead (canned numbers)",
        "  --mode keyless|keyed     override every scenario's mode",
        "  --nights N               override every scenario's night count",
        "  --throttle-wait <ms>     how long to sit out a kp 429 (default 65000; kp's",
        "                           per-IP windows are fixed 10-minute buckets)",
        "  --out <dir>              bench root (default bench/app-master)",
        "  --report                 also write bench/app-master/REPORT.md when done,",
        "                           pass or fail (what `npm run bench:app-master` does)",
        "",
      ].join("\n")
    );
    return 0;
  }

  const benchRoot = args.out ? path.resolve(args.out) : DEFAULT_BENCH_ROOT;
  const files = args.all
    ? listScenarioFiles()
    : [resolveScenarioPath(String(args.scenario || "kp-default"))];
  if (files.length === 0) {
    process.stderr.write("no scenarios found\n");
    return 1;
  }

  const scenarios = files.map((f) => {
    if (!existsSync(f)) throw new Error(`scenario file not found: ${f}`);
    const s = loadScenarioFile(f, { kpRoot: REPO_ROOT });
    if (args.mode) s.mode = String(args.mode);
    if (args.nights !== undefined) s.nights = Number(args.nights);
    return s;
  });

  const kpUrl = String(args.kp || process.env.KP_BENCH_URL || "http://localhost:3101");

  let stub = null;
  let personasUrl = String(args.personas || process.env.PERSONAS_BENCH_URL || "http://127.0.0.1:9420");
  let personasKey = args["personas-key"] ? String(args["personas-key"]) : process.env.PERSONAS_API_KEY || null;

  const keyCacheFile = path.join(benchRoot, "personas-key.json");
  if (!personasKey && existsSync(keyCacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(keyCacheFile, "utf8"));
      if (cached.baseUrl?.replace(/\/$/, "") === personasUrl.replace(/\/$/, "")) personasKey = cached.apiKey;
    } catch {
      /* a corrupt cache just means re-pairing */
    }
  }

  if (args["stub-personas"]) {
    const { startStubPersonas } = await import("./stub.mjs");
    stub = await startStubPersonas({ kpBaseUrl: kpUrl });
    personasUrl = stub.url;
    personasKey = null; // the stub mints its own; pair against it for real
    process.stderr.write(`stub Personas (headless bridge, CANNED numbers) at ${personasUrl}\n`);
  }

  const opts = {
    kpUrl,
    personasUrl,
    personasKey,
    benchRoot,
    stub: !!stub,
    // A stub run never writes the cache: its key dies with the process.
    keyCacheFile: stub ? null : keyCacheFile,
    scanTimeoutMs: Number(args["scan-timeout"] || 20 * 60_000),
    activateTimeoutMs: Number(args["activate-timeout"] || 5 * 60_000),
    // How long to sit out a 429 before retrying. kp's windows are fixed
    // 10-minute buckets, so 65s × 12 attempts crosses one from anywhere inside it.
    throttleWaitMs: Number(args["throttle-wait"] || 65_000),
  };

  const results = [];
  try {
    // SERIAL, ALWAYS — and this is a deliberate constraint, not a TODO. A live
    // night runs the App master through the local Claude CLI, which is one
    // subscription seat: two scenarios at once do not halve the wall clock,
    // they collide on the session limit and both degrade. One at a time.
    for (const scenario of scenarios) {
      process.stderr.write(`\n=== ${scenario.name} (${scenario.mode}, ${scenario.nights} night(s)) ===\n`);
      const result = await runScenario(scenario, opts);
      results.push(result);
      printSummary(result);
    }
  } finally {
    await stub?.close();
    // `--report` renders the aggregate IN-PROCESS, so a sweep that failed still
    // writes REPORT.md — an `&&` chain would skip it exactly when it matters.
    if (args.report) {
      const { writeReport } = await import("./report.mjs");
      const { dest, runs } = writeReport(benchRoot);
      process.stderr.write(`
wrote ${dest} (${runs} run(s))
`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  process.stderr.write(
    `\n${verdictBanner([
      `${results.length - failed.length}/${results.length} scenarios PASS`,
      failed.length > 0 ? `${failed.length} FAIL: ${failed.map((r) => `${r.scenario.name}${r.failedPhase ? `@${r.failedPhase}` : ""}`).join(", ")}` : "",
    ])}\n`
  );
  return failed.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`\nbench driver failed: ${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}

export { runScenario, findFirst };
