// A stub Personas in HEADLESS BRIDGE mode, in-process, for proving the driver
// end to end before P6a lands (and for keeping the report renderer honest with
// a real fixture rather than a hand-written one).
//
// It is a port of e2e/fixtures/mock-personas-bridge.ts — same routes, same
// envelopes, same refusals — with the three things P6a adds on top:
//
//   GET  /health                    → {status:"ok", management:true, headlessBridge:true}
//   GET  /pair/claim?nonce=…        → the FIRST claim hands the pk_ key over
//                                     (headless mode auto-approves; the mock's
//                                     "pending then key" ladder is the human one)
//   POST /api/kp/persona-requests   → auto-executes: the request reaches `active`
//                                     with no human, so /refresh sees it live
//   POST /api/kp/test/seed-work     → backlog work for the night to dispatch
//                                     (P6e; §13.9 of the bridge doc)
//   POST /api/kp/test/tick          → one compressed night per call
//   POST /api/kp/test/retire        → archive the persona and push
//                                     `lifecycle: retired` to kp (c1-exam §4).
//                                     OFF unless `retireRoute` is set: Personas
//                                     does not ship it yet, and the stub models
//                                     what Personas ships.
//
// ⚠ EVERYTHING IT REPORTS IS CANNED. The stub does not run an agent, gate a
// branch or spend a cent. Its numbers exist to exercise the driver's plumbing;
// a run against it is stamped `personas.stub: true` in result.json and the
// aggregate report marks the row, so a stub number is never read as a measurement.
// The one thing it models faithfully is the SHAPE of what P6a returns, and the
// three facts a night's outcome genuinely depends on: the scope rung, the
// monthly ceiling, and — since P6f — that a DISPATCH IS NOT A BRANCH. An
// overnight tick launches sessions and returns; their branches only become
// visible to `reconcile` some polls later (`STUB_BRANCH_DELAY_RECONCILES`), so a
// driver that reconciles and reports in the same breath measures nothing here
// either. That is not stub pessimism: it is the 2026-08-25 sweep's reading,
// where reconcile ran 173 ms after a 3-session dispatch and saw `branchesSeen: 0`.

import { createServer } from "node:http";

const CATALOG = [
  { key: "github", name: "github", description: "Read repositories, open issues and pull requests, review code" },
  { key: "linear", name: "linear", description: "Create and triage Linear issues and projects" },
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** How many proposals one night could open if nothing stopped it. The real
 *  engine's cap is the fleet live-slot count; three is the stub's stand-in. */
const STUB_SLOT_CAP = 3;

/**
 * The canned outcome of ONE night, from the mandate facts that decide it — and,
 * since P6e, from the BACKLOG. `state.pendingSeeds` is how much unaccepted work
 * the project holds; a night with none dispatches nothing, which is not a
 * pessimistic stub choice but the behaviour bench sweeps #11 and #12 recorded
 * against the real engine. `blockedReason` mirrors `NightRun.blocked_reason`
 * and `degraded` mirrors the budget governor's `full → suggest` flag, so the
 * driver's budget check reads the same evidence here as against Personas.
 */
export function cannedNight(state, appMaster) {
  const rung = appMaster?.mandate?.scopeRung ?? 2;
  const ceiling = Number(appMaster?.budget?.monthlyUsd ?? 0) || 0;
  const tight = ceiling > 0 && ceiling <= 10;
  const pending = Math.max(0, state.pendingSeeds ?? 0);

  const notes = [];
  let opened = 0;
  let blockedReason = null;
  let degraded = false;
  if (pending === 0) {
    notes.push("overnight dispatched nothing: the project holds no accepted idea. Seed the project first.");
  } else if (rung === 0) {
    blockedReason = `App master mandate rung 0 may not author a change (${pending} accepted idea(s) left for the morning)`;
    notes.push("overnight produced no proposal: the mandate is rung 0 — read and report only.");
  } else if (tight && state.settledUsd >= ceiling) {
    degraded = true;
    blockedReason = `Budget governor refused tonight's dispatch: the monthly ceiling of $${ceiling} is spent. Autopilot degraded full → suggest.`;
    notes.push(`overnight halted: the monthly budget ceiling of $${ceiling} was reached — no session was dispatched.`);
  } else {
    opened = Math.min(pending, tight ? 1 : STUB_SLOT_CAP);
    state.pendingSeeds = pending - opened;
    notes.push(`overnight dispatched ${opened} session(s) and authored ${opened} proposal branch(es).`);
  }

  // A dispatch does not open a proposal — it launches a session that will
  // author a branch some minutes later, and RECONCILE is what turns that branch
  // into a recorded proposal. So the counters move in `cannedReconcile`, and
  // this night only records how many sessions are now out there authoring.
  state.awaitingBranches = opened;
  state.pendingMerges = rung === 0 ? 0 : Math.max(0, opened - 1);
  if (opened > 0) state.reconcilesSinceDispatch = 0;
  // Spend follows the sessions that actually ran, and the stub deliberately
  // overruns a tight ceiling on the first night so the degrade path is exercised.
  state.settledUsd = Math.min(ceiling || Infinity, state.settledUsd + (opened > 0 ? (tight ? ceiling : 1.85) : 0));

  const budgetExhausted = tight && ceiling > 0 && state.settledUsd >= ceiling;
  const autopilotMode = rung === 0 ? "measure" : budgetExhausted ? "off" : "suggest";
  if (budgetExhausted) notes.push(`autopilot degraded to "off": the $${ceiling} monthly ceiling is spent.`);

  return { opened, notes, autopilotMode, blockedReason, degraded, pendingAfter: state.pendingSeeds ?? 0 };
}

/** A row the operator's own deck held before this App master was hired. Dated
 *  far enough back that any plausible `hiredAt` is after it — the point of the
 *  fixture is that the since-hire filter can tell it from tonight's work. */
const STUB_PRE_TENURE_AT = "2026-01-01T00:00:00.000Z";

/**
 * ONE ideation night (c1-exam §2), as a build that UNDERSTOOD the ask answers
 * it: a list, a decline log, and an `ideation` block saying it ran.
 *
 * Two properties are the whole reason this exists. First, the override is
 * HONOURED — `autopilot: "suggest"` means nothing is dispatched, so the driver's
 * dispatch guard has a clean night to read as clean. Second, the rows are
 * DATED and they are not all the holder's: two of them are the inherited
 * operator deck (2026-01-01), which is exactly what the live 2026-08-30 tick
 * reported back as the holder's `proposals[]`. A stub that only emitted
 * tonight's work could not tell the driver's since-hire filter from a no-op.
 */
export function cannedIdeation({ at = new Date().toISOString() } = {}) {
  const mine = (title, journey, axis) => ({ title, journey, axis, size: "s", confidence: 0.6, createdAt: at, origin: "night" });
  const proposals = [
    { title: "Seed the ISPV band table the salary anchor falls back to", createdAt: STUB_PRE_TENURE_AT, origin: "operator-deck" },
    { title: "Cache the market-pulse build between refreshes", createdAt: STUB_PRE_TENURE_AT, origin: "operator-deck" },
    mine("Name the degrade path on every keyless analysis card", "cv-analysis", "risk"),
    mine("Collapse the two duplicated workspace headers", "workspace-shell", "time"),
    mine("Fail the schedule token route closed when the projection drifts", "self-scheduling", "gate"),
  ];
  const declines = [
    { title: "Rewrite the pipeline board in a table", reason: "low-value", createdAt: at, origin: "night" },
    { title: "Bump every dependency to satisfy the audit", reason: "outside-mandate", createdAt: STUB_PRE_TENURE_AT, origin: "operator-deck" },
  ];
  const authored = proposals.filter((p) => p.origin === "night").length;
  return {
    proposals,
    declines,
    ideation: { ran: true, lens: "stabilize", authored, blocked: null },
    notes: [`overnight ideated: ${authored} proposal(s) authored, ${declines.length} candidate(s) declined. Nothing was dispatched — autopilot suggest.`],
  };
}

/** The rollup the report phase pushes — read from the state as it stands WHEN
 *  THE REPORT RUNS, never snapshotted at dispatch time. A night that reported
 *  before its branches reconciled therefore reports zero proposals opened,
 *  which is precisely the reading a driver without a settle wait produced. */
export function cannedBackbone(state, appMaster) {
  const ceiling = Number(appMaster?.budget?.monthlyUsd ?? 0) || 0;
  const objectives = Array.isArray(appMaster?.objectives) ? appMaster.objectives : [];
  return {
    windowDays: 30,
    proposalsOpened: state.opened,
    proposalsMerged: state.merged,
    proposalsReverted: 0,
    gatePassRate: state.gatesRun > 0 ? Number((state.gatesPassed / state.gatesRun).toFixed(4)) : null,
    forbiddenClassViolations: 0,
    kpiDeltas: objectives.map((o, i) => ({
      kpiKey: o.kpiKey,
      baseline: 78,
      // Only the FIRST objective is measured — a stub that measured them all
      // would never exercise the coverage gap the backbone exists to surface.
      current: i === 0 ? 94 : null,
      target: o.target ?? 95,
      direction: o.direction ?? "gte",
      windowDays: o.windowDays ?? 30,
      measured: i === 0,
    })),
    budgetReservedUsd: ceiling,
    budgetSettledUsd: Number(state.settledUsd.toFixed(2)),
    budgetUnmeasured: false,
    ledgerConsistent: true,
  };
}

/** The canned day-N verdict: nothing delivered ⇒ more probation, never a pass. */
export function cannedProbation(state, appMaster) {
  const rung = appMaster?.mandate?.scopeRung ?? 2;
  if (rung === 0) {
    return { decision: "extended", rationale: "a rung-0 mandate authored nothing to judge delivery on." };
  }
  if (state.merged === 0) {
    return { decision: "extended", rationale: "no proposal was merged in the window." };
  }
  return { decision: "activated", rationale: `${state.merged} of ${state.opened} proposals merged and stayed merged.` };
}

/** How many reconcile calls after a dispatch before the fleet's branches are
 *  visible. TWO by default, and that default is the point: a real overnight
 *  DISPATCHES and returns, and the Claude sessions it launched go on authoring
 *  branches for minutes afterwards — the 2026-08-25 sweep reconciled 173 ms
 *  after a 3-session dispatch and saw `branchesSeen: 0`. A stub whose branches
 *  appear on the first reconcile would let a driver with no settle wait pass. */
export const STUB_BRANCH_DELAY_RECONCILES = 2;

/**
 * The canned outcome of ONE reconcile call. Branches appear only once
 * `reconcilesSinceDispatch` reaches `delay`; before that the phase runs and
 * honestly reports zero, which is exactly the shape the live bridge returned.
 */
export function cannedReconcile(state, delay = STUB_BRANCH_DELAY_RECONCILES) {
  state.reconcilesSinceDispatch = (state.reconcilesSinceDispatch ?? 0) + 1;
  const awaiting = Math.max(0, state.awaitingBranches ?? 0);
  const ready = awaiting > 0 && state.reconcilesSinceDispatch >= delay;
  const seen = ready ? awaiting : 0;
  if (ready) {
    state.awaitingBranches = 0;
    state.branchesRecorded = (state.branchesRecorded ?? 0) + seen;
    // A recorded branch IS the opened proposal, and its gate outcomes are
    // recorded in the same pass — this is where the delivery and gate lanes
    // become measurable at all.
    state.opened += seen;
    state.merged += Math.min(seen, state.pendingMerges ?? 0);
    state.pendingMerges = 0;
    state.gatesRun += seen * 6;
    state.gatesPassed += seen * 6 - 1;
  }
  return {
    counts: {
      projects: 1,
      branchesSeen: seen,
      newlyRecorded: seen,
      gated: seen,
      errors: [],
    },
    reconcilesSinceDispatch: state.reconcilesSinceDispatch,
    awaiting: state.awaitingBranches ?? 0,
    proposalsRecorded: state.branchesRecorded ?? 0,
    gateRuns: state.gatesRun,
    gatesPassed: state.gatesPassed,
    gatesDidNotRun: 0,
  };
}

/** The canned reason a `--stub-build-fail-once` build dies with. Copied from a
 *  live sweep rather than invented: this is what a real held promotion read as
 *  on the wire, and the driver's failure record has to survive that exact shape. */
export const STUB_BUILD_FAILURE = { phase: "design", status: "failed", reason: "promotion held: tools never called" };

/**
 * Start the stub. `kpBaseUrl` is where report pushes go when the dispatch body
 * carries no reachable `kp.baseUrl` of its own. `branchesAfterReconciles` is how
 * many reconcile calls a dispatched night takes to show its branches.
 *
 * `buildFailsOnce` makes the FIRST persona request's build die the way a real
 * one does — the status read answers `failed` with a `buildPhase` reason
 * instead of `active`. Personas' one-shot build is nondeterministic and a
 * meaningful fraction of hires fail for reasons unrelated to the role; this is
 * the knob that puts the driver's build retry under test without one.
 *
 * `ideationNights` makes the tick answer an `ideate: true` body the way a build
 * that ships ideation would (c1-exam §2): it HONOURS the `autopilot` override —
 * nothing is dispatched under `suggest` — and its overnight phase carries an
 * `ideation` block plus dated `proposals[]` / `declines[]`. **Off by default**,
 * for the same reason `retireRoute` is: today's Personas answers a tick that
 * asks for ideation exactly as it answers one that does not, which is how a
 * live ideation night came to dispatch 58 ideas. The default stub models that
 * build, so the driver's dispatch guard is exercised against it.
 *
 * `retireRoute` mounts `POST /api/kp/test/retire` — the ONE Personas-side route
 * the C1 protocol asks for (c1-exam §4). It is **off by default on purpose**:
 * the stub's job is to model what Personas SHIPS, and Personas does not ship
 * this yet, so the default run exercises the 404 branch a live `--teardown`
 * takes today. Turn it on to exercise the other half.
 */
export async function startStubPersonas({
  kpBaseUrl = null,
  branchesAfterReconciles = STUB_BRANCH_DELAY_RECONCILES,
  buildFailsOnce = false,
  retireRoute = false,
  ideationNights = false,
} = {}) {
  let buildsLeftToFail = buildFailsOnce ? 1 : 0;
  const apiKey = `pk_stub_${Math.random().toString(36).slice(2, 10)}`;
  const nonces = new Set();
  const dispatches = [];
  const state = new Map(); // requestId -> running totals
  let seq = 0;

  const stub = {
    url: "",
    apiKey,
    dispatches,
    // Every tick body the stub answered, in order — the wire record a test
    // reads to prove what the driver asked for.
    ticks: [],
    unauthorizedCalls: 0,
    unknownPaths: [],
    pushes: [],
    close: async () => undefined,
  };

  const authorized = (req) => {
    if ((req.headers.authorization ?? "") === `Bearer ${apiKey}`) return true;
    stub.unauthorizedCalls += 1;
    return false;
  };

  /** Push a report to kp exactly the way a hired persona would. */
  async function push(dispatch, payload) {
    const base = (dispatch.kp?.baseUrl || kpBaseUrl || "").replace(/\/$/, "");
    if (!base || !dispatch.reportToken) {
      return { ok: false, error: "no kp base url or report token on this dispatch" };
    }
    try {
      const res = await fetch(`${base}/api/agents/report/${dispatch.reportToken}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      const out = { ok: res.ok, status: res.status, body: body.slice(0, 400) };
      stub.pushes.push({ kind: payload.kind, ...out });
      return out;
    } catch (error) {
      const out = { ok: false, status: 0, error: String(error?.message || error) };
      stub.pushes.push({ kind: payload.kind, ...out });
      return out;
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const p = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "GET" && p === "/health") {
        json(res, 200, { status: "ok", management: true, headlessBridge: true });
        return;
      }

      if (method === "POST" && p === "/pair/request") {
        const body = await readJson(req);
        // Mirror the real bridge: pairing origin comes from the Origin header.
        if (!req.headers.origin) {
          json(res, 400, { error: "Origin header required" });
          return;
        }
        const nonce = typeof body.nonce === "string" ? body.nonce : "";
        if (nonce.length < 16) {
          json(res, 400, { error: "nonce must be at least 16 characters" });
          return;
        }
        nonces.add(nonce);
        json(res, 200, { ok: true, expiresInS: 300 });
        return;
      }

      if (method === "GET" && p === "/pair/claim") {
        const nonce = url.searchParams.get("nonce") ?? "";
        if (!nonces.has(nonce)) {
          json(res, 404, { error: "unknown or spent nonce" });
          return;
        }
        nonces.delete(nonce); // single-use, as the real claim is
        // Headless bridge mode: NO human beat. The first claim hands the key over.
        // The real bridge's claim shape (probed 2026-08-24): { token }.
        json(res, 200, { token: apiKey });
        return;
      }

      if (method === "GET" && p === "/api/kp/connector-catalog") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        json(res, 200, { success: true, data: { connectors: CATALOG } });
        return;
      }

      if (method === "POST" && p === "/api/kp/persona-requests") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const body = await readJson(req);
        const requestId = `req-stub-${++seq}`;
        // Decided AT DISPATCH, not at read time: a request whose build died
        // stays dead however often it is polled, and the NEXT dispatch (the
        // driver's retry) gets a healthy build.
        const buildFails = buildsLeftToFail > 0;
        if (buildFails) buildsLeftToFail -= 1;
        const dispatch = {
          requestId,
          buildFails,
          personaId: `persona-stub-${seq}`,
          personaName: body.spec?.name || body.appMaster?.role?.title || "App master",
          kp: body.kp ?? {},
          spec: body.spec ?? {},
          appMaster: body.appMaster ?? null,
          reportToken: typeof body.reportToken === "string" ? body.reportToken : "",
        };
        dispatches.push(dispatch);
        // Auto-execute: headless mode approves and builds without a human, so
        // the request is `active` by the time kp polls it.
        state.set(requestId, {
          opened: 0,
          merged: 0,
          settledUsd: 0,
          gatesRun: 0,
          gatesPassed: 0,
          nights: 0,
          // The backlog. A night can only dispatch what seeding put here.
          pendingSeeds: 0,
          seededKeys: new Map(),
          seedRuleId: null,
          // The fleet in flight: sessions dispatched whose branches have not
          // been reconciled yet, and how many reconciles have run since.
          awaitingBranches: 0,
          pendingMerges: 0,
          branchesRecorded: 0,
          reconcilesSinceDispatch: 0,
        });
        json(res, 200, { success: true, data: { requestId } });
        return;
      }

      const statusMatch = /^\/api\/kp\/persona-requests\/([^/]+)$/.exec(p);
      if (method === "GET" && statusMatch) {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const requestId = decodeURIComponent(statusMatch[1]);
        const dispatch = dispatches.find((d) => d.requestId === requestId);
        if (!dispatch) {
          json(res, 404, { success: false, error: "unknown request" });
          return;
        }
        json(res, 200, {
          success: true,
          data: dispatch.retired
            ? { status: "retired", personaId: dispatch.personaId, personaName: dispatch.personaName }
            : dispatch.buildFails
            ? {
                status: "failed",
                personaId: dispatch.personaId,
                personaName: dispatch.personaName,
                buildPhase: { ...STUB_BUILD_FAILURE },
              }
            : { status: "active", personaId: dispatch.personaId, personaName: dispatch.personaName },
        });
        return;
      }

      if (method === "POST" && p === "/api/kp/test/seed-work") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const body = await readJson(req);
        const dispatch =
          dispatches.find((d) => d.personaId === body.personaId) ??
          dispatches.find((d) => d.requestId === body.projectId) ??
          null;
        if (!dispatch) {
          json(res, 404, {
            success: false,
            error: "no hire on this stub matches that personaId / projectId",
          });
          return;
        }
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0 || items.length > 16) {
          json(res, 400, { success: false, error: "items must carry 1..16 entries" });
          return;
        }
        const running = state.get(dispatch.requestId);
        // Dedup on the normalised title, the way `scan_dedup_key` does — the
        // stub's cheap version of the same identity, so a repeated seed is a
        // skip here too rather than a second idea.
        const answers = items.map((item, index) => {
          const title = String(item?.title ?? "").trim();
          const key = `scan:headless_bench_seed:bench:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
          const already = running.seededKeys.has(key);
          if (!already) {
            running.seededKeys.set(key, `idea-stub-${running.seededKeys.size + 1}`);
            running.pendingSeeds += 1;
          }
          return {
            index,
            title,
            id: running.seededKeys.get(key),
            accepted: !already,
            dedupKey: key,
            ideaStatus: "pending",
            ...(already
              ? { skippedReason: "this project already holds an idea with this dedup key" }
              : {}),
            // Echoed, stored nowhere — exactly as the real endpoint answers.
            ...(item?.acceptance ? { acceptance: item.acceptance } : {}),
            ...(item?.trap ? { trap: item.trap } : {}),
          };
        });
        const created = !running.seedRuleId;
        if (created) running.seedRuleId = `rule-stub-${dispatch.requestId}`;
        json(res, 200, {
          success: true,
          data: {
            headlessBridge: true,
            actor: "headless_bridge",
            acceptanceStored: false,
            note: "items are written `pending`; the next tick's overnight triage pass is what accepts and dispatches them",
            seed: {
              projectId: dispatch.requestId,
              projectName: dispatch.personaName,
              scanType: "headless_bench_seed",
              seeded: answers.filter((a) => a.accepted).length,
              skipped: answers.filter((a) => !a.accepted).length,
              items: answers,
              triageRule: {
                id: running.seedRuleId,
                name: "Headless bench seed — auto-accept",
                conditions: '[{"field":"scan_type","op":"eq","value":"headless_bench_seed"}]',
                action: "accept",
                enabled: true,
                created,
                rulesAhead: 0,
                willAccept: true,
              },
              notes: [],
            },
          },
        });
        return;
      }

      if (method === "POST" && p === "/api/kp/test/retire" && retireRoute) {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const body = await readJson(req);
        const dispatch = dispatches.find((d) => d.personaId === body.personaId) ?? null;
        if (!dispatch) {
          json(res, 404, { success: false, error: "no hire on this stub matches that personaId" });
          return;
        }
        dispatch.retired = true;
        // kp is told the way it is told every other lifecycle event: a push to
        // the report route, whose token the driver never holds. The archive is
        // Personas' half; the roster flip is kp's.
        const pushed = await push(dispatch, {
          kind: "lifecycle",
          event: "retired",
          personaId: dispatch.personaId,
          personaName: dispatch.personaName,
          note: "retired by the bench teardown",
        });
        json(res, 200, { success: true, data: { personaId: dispatch.personaId, archived: true, reported: pushed.ok } });
        return;
      }

      if (method === "POST" && p === "/api/kp/test/tick") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const body = await readJson(req);
        const dispatch =
          dispatches.find((d) => d.personaId === body.personaId) ??
          dispatches.find((d) => d.requestId === body.projectId) ??
          dispatches[dispatches.length - 1];
        if (!dispatch) {
          json(res, 404, { success: false, error: "nothing has been hired on this stub yet" });
          return;
        }
        const running = state.get(dispatch.requestId);
        const phases = Array.isArray(body.phases) && body.phases.length > 0
          ? body.phases
          : ["overnight", "reconcile", "report"];
        const summary = { projectId: dispatch.requestId, personaId: dispatch.personaId, phases: {} };
        // What the tick was ASKED for, beyond its phases — recorded verbatim so
        // a test can assert the body the driver actually put on the wire, and
        // that a scenario with no `night` block put nothing extra on it.
        const ask = {
          ...(body.ideate === undefined ? {} : { ideate: body.ideate }),
          ...(body.autopilot === undefined ? {} : { autopilot: body.autopilot }),
        };
        stub.ticks.push({ personaId: body.personaId ?? null, phases: [...phases], ...ask });

        if (phases.includes("overnight") && ideationNights && ask.ideate === true) {
          // A build that understands the ask: a list instead of a dispatch.
          running.nights += 1;
          const authored = cannedIdeation();
          running.awaitingBranches = 0;
          running.pendingMerges = 0;
          running.lastNight = { opened: 0, notes: authored.notes, autopilotMode: ask.autopilot ?? "suggest", blockedReason: null, degraded: false };
          summary.phases.overnight = {
            nightRunId: `night-stub-${dispatch.requestId}-${running.nights}`,
            dispatchedCount: 0,
            notes: authored.notes,
            autopilotMode: ask.autopilot ?? "suggest",
            counts: { projects: 1, dispatched: 0, blocked: 0, degraded: 0 },
            ideation: authored.ideation,
            proposals: authored.proposals,
            declines: authored.declines,
          };
        } else if (phases.includes("overnight")) {
          running.nights += 1;
          const night = cannedNight(running, dispatch.appMaster);
          running.lastNight = night;
          summary.phases.overnight = {
            nightRunId: `night-stub-${dispatch.requestId}-${running.nights}`,
            dispatchedCount: night.opened,
            notes: night.notes,
            autopilotMode: night.autopilotMode,
            // The real bridge's §13.6 counts block + the NightRun ledger row it
            // itemises. The driver's budgetDegraded check reads exactly these,
            // so a stub that omitted them would exercise a different code path
            // than the one a live sweep takes.
            counts: {
              projects: 1,
              dispatched: night.opened,
              blocked: night.blockedReason ? 1 : 0,
              degraded: night.degraded ? 1 : 0,
            },
            details: [
              {
                nightRunId: `night-stub-${dispatch.requestId}-${running.nights}`,
                dispatchedCount: night.opened,
                blockedReason: night.blockedReason,
                degraded: night.degraded,
              },
            ],
          };
        }
        if (phases.includes("reconcile")) {
          summary.phases.reconcile = cannedReconcile(running, branchesAfterReconciles);
        }
        if (phases.includes("report")) {
          const backbone = cannedBackbone(running, dispatch.appMaster);
          const autopilotMode = running.lastNight?.autopilotMode ?? "suggest";
          const period = new Date().toISOString().slice(0, 7);
          const pushed = await push(dispatch, {
            kind: "rollup",
            period,
            runs: running.opened,
            successes: running.merged,
            failures: Math.max(0, running.opened - running.merged),
            costUsd: backbone.budgetSettledUsd,
            tokensIn: 214_000,
            tokensOut: 38_000,
            connectorUses: [{ connector: "github", calls: 37 }],
            ...backbone,
            autopilotMode,
          });
          summary.phases.report = { delivered: pushed.ok, status: pushed.status, backbone };
        }
        if (phases.includes("probation")) {
          const verdict = cannedProbation(running, dispatch.appMaster);
          const pushed = await push(dispatch, {
            kind: "lifecycle",
            event: "probation_review",
            decision: verdict.decision,
            personaId: dispatch.personaId,
            personaName: dispatch.personaName,
            note: verdict.rationale,
          });
          summary.phases.probation = { ...verdict, delivered: pushed.ok, status: pushed.status };
        }

        json(res, 200, { success: true, data: summary });
        return;
      }

      stub.unknownPaths.push(`${method} ${p}`);
      json(res, 404, { error: "no such route on the stub Personas bridge" });
    })().catch((error) => {
      if (!res.headersSent) json(res, 500, { error: `stub bridge failed: ${String(error?.message || error)}` });
      else res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${server.address().port}`;
  stub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return stub;
}
