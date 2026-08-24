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
//   POST /api/kp/test/tick          → one compressed night per call
//
// ⚠ EVERYTHING IT REPORTS IS CANNED. The stub does not run an agent, gate a
// branch or spend a cent. Its numbers exist to exercise the driver's plumbing;
// a run against it is stamped `personas.stub: true` in result.json and the
// aggregate report marks the row, so a stub number is never read as a measurement.
// The one thing it models faithfully is the SHAPE of what P6a returns, and the
// two mandate facts a night's outcome genuinely depends on: the scope rung and
// the monthly ceiling.

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

/** The canned outcome of ONE night, from the two mandate facts that decide it. */
export function cannedNight(state, appMaster) {
  const rung = appMaster?.mandate?.scopeRung ?? 2;
  const ceiling = Number(appMaster?.budget?.monthlyUsd ?? 0) || 0;
  const objectives = Array.isArray(appMaster?.objectives) ? appMaster.objectives : [];
  const tight = ceiling > 0 && ceiling <= 10;

  const notes = [];
  let opened = 0;
  if (rung === 0) {
    notes.push("overnight produced no proposal: the mandate is rung 0 — read and report only.");
  } else if (tight && state.settledUsd >= ceiling) {
    notes.push(`overnight halted: the monthly budget ceiling of $${ceiling} was reached — no session was dispatched.`);
  } else {
    opened = tight ? 1 : 3;
    notes.push(`overnight dispatched ${opened} session(s) and authored ${opened} proposal branch(es).`);
  }

  state.opened += opened;
  state.merged += rung === 0 ? 0 : Math.max(0, opened - 1);
  // Spend follows the sessions that actually ran, and the stub deliberately
  // overruns a tight ceiling on the first night so the degrade path is exercised.
  state.settledUsd = Math.min(ceiling || Infinity, state.settledUsd + (opened > 0 ? (tight ? ceiling : 1.85) : 0));
  state.gatesRun += opened * 6;
  state.gatesPassed += opened * 6 - (opened > 0 ? 1 : 0);

  const budgetExhausted = tight && ceiling > 0 && state.settledUsd >= ceiling;
  const autopilotMode = rung === 0 ? "measure" : budgetExhausted ? "off" : "suggest";
  if (budgetExhausted) notes.push(`autopilot degraded to "off": the $${ceiling} monthly ceiling is spent.`);

  const backbone = {
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

  return { opened, notes, autopilotMode, backbone };
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

/**
 * Start the stub. `kpBaseUrl` is where report pushes go when the dispatch body
 * carries no reachable `kp.baseUrl` of its own.
 */
export async function startStubPersonas({ kpBaseUrl = null } = {}) {
  const apiKey = `pk_stub_${Math.random().toString(36).slice(2, 10)}`;
  const nonces = new Set();
  const dispatches = [];
  const state = new Map(); // requestId -> running totals
  let seq = 0;

  const stub = {
    url: "",
    apiKey,
    dispatches,
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
        json(res, 200, { apiKey, scopes: ["personas:read", "personas:build", "personas:test"] });
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
        const dispatch = {
          requestId,
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
        state.set(requestId, { opened: 0, merged: 0, settledUsd: 0, gatesRun: 0, gatesPassed: 0, nights: 0 });
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
          data: { status: "active", personaId: dispatch.personaId, personaName: dispatch.personaName },
        });
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

        if (phases.includes("overnight")) {
          running.nights += 1;
          const night = cannedNight(running, dispatch.appMaster);
          running.lastNight = night;
          summary.phases.overnight = {
            nightRunId: `night-stub-${dispatch.requestId}-${running.nights}`,
            dispatchedCount: night.opened,
            notes: night.notes,
            autopilotMode: night.autopilotMode,
          };
        }
        if (phases.includes("reconcile")) {
          summary.phases.reconcile = {
            proposalsRecorded: running.opened,
            gateRuns: running.gatesRun,
            gatesPassed: running.gatesPassed,
            gatesDidNotRun: 0,
          };
        }
        if (phases.includes("report")) {
          const night = running.lastNight ?? cannedNight(running, dispatch.appMaster);
          const period = new Date().toISOString().slice(0, 7);
          const pushed = await push(dispatch, {
            kind: "rollup",
            period,
            runs: running.opened,
            successes: running.merged,
            failures: Math.max(0, running.opened - running.merged),
            costUsd: night.backbone.budgetSettledUsd,
            tokensIn: 214_000,
            tokensOut: 38_000,
            connectorUses: [{ connector: "github", calls: 37 }],
            ...night.backbone,
            autopilotMode: night.autopilotMode,
          });
          summary.phases.report = { delivered: pushed.ok, status: pushed.status, backbone: night.backbone };
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
