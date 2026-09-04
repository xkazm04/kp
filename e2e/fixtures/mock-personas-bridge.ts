import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
// `import type`, not a value import: scripts/app-master-bench/personas-contract.test.mjs
// loads this file through node's type STRIPPING (no compile step), and stripping
// only erases syntax that is unambiguously a type. A bare `import { AddressInfo }`
// survives erasure as a real runtime import and dies on `node:net` having no such
// export — which is exactly how far that test got on its first run.
import type { AddressInfo } from "node:net";

// A stand-in for the Personas desktop app's management API, so the whole
// App-master hire path can be battle-tested WITHOUT Personas installed
// (e2e/app-master-hire.spec.ts). It is deliberately small and deliberately
// strict: the point is to catch kp-side integration bugs, so every route
// answers in the shape the real bridge documents and REFUSES what the real one
// would refuse (an unauthenticated management call, a claim for a nonce nobody
// registered, a second claim of a spent nonce).
//
// Contract implemented (app/_lib/agent-hire/pairing.ts + bridge-client.ts):
//
//   POST /pair/request                    {nonce, scopes, client} → 200 {ok:true}
//   GET  /pair/claim?nonce=…              1st call → 200 {status:"pending"}
//                                         2nd call → 200 {token:"pk_mock…"} (single-use)
//   GET  /api/kp/connector-catalog        → {success:true, data:{connectors:[…]}}
//   POST /api/kp/persona-requests         Bearer-gated; records the body
//                                         (including the P4 `appMaster` block)
//                                         → {success:true, data:{requestId}}
//   GET  /api/kp/persona-requests/{id}    Bearer-gated; the status LADDER the
//                                         test drives (pending_approval →
//                                         onboarding → active)
//   GET  /health                          → {status:"ok", management:true}
//
// Two shapes are exercised on purpose: the catalog and the persona-request
// routes answer inside Personas' `ApiResult` envelope (`{success, data}`), which
// bridge-client.ts must unwrap, while the pairing routes answer bare — that is
// how the real management API is split today.
//
// Loopback only (127.0.0.1, port 0 → a free port per run), so two runs never
// collide and the KP_OFFLINE egress guard (app/_lib/offline.ts allows loopback)
// still lets kp dial it.

/** One recorded `POST /api/kp/persona-requests` body. */
export type RecordedDispatch = {
  /** `Authorization` header exactly as it arrived. */
  authorization: string | null;
  kp: {
    baseUrl?: string;
    jobId?: string;
    jobTitle?: string;
    workspace?: string;
    /** App-master hires only — the intake the spec was composed in. */
    intakeId?: string;
  };
  /** The flat bridge spec, projected from `appMaster.agent`. */
  spec: {
    name?: string;
    mission?: string;
    systemPromptDraft?: string;
    connectors?: string[];
    maxBudgetUsd?: number | null;
    maxTurns?: number | null;
    successMetrics?: unknown[];
  };
  /** The capability the hired persona reports back with. */
  reportToken: string;
  /** The whole AppMasterSpec — present only on an App-master hire. */
  appMaster?: unknown;
  /** The request id this mock answered with. */
  requestId: string;
};

export type MockPersonasBridge = {
  /** `http://127.0.0.1:<port>` — what the operator types into Settings → Integrations. */
  url: string;
  /** The pk_ key the claim hands over once "approved". */
  apiKey: string;
  /** Every registered pairing nonce, in arrival order. */
  pairRequests: { nonce: string; scopes: unknown; client: unknown }[];
  /** How many times /pair/claim was polled (the UI polls every ~2s). */
  claimAttempts: number;
  /** Every accepted persona request, oldest first. */
  dispatches: RecordedDispatch[];
  /** The most recent accepted persona request, or null. */
  lastDispatch(): RecordedDispatch | null;
  /** Management calls refused for a missing/incorrect bearer token. */
  unauthorizedCalls: number;
  /** Requests that hit no route (a kp-side path typo would show up here). */
  unknownPaths: string[];
  /** Drive the approval ladder the refresh poll reads. */
  setRequestStatus(status: string, persona?: { id?: string; name?: string }): void;
  /** What `GET /api/kp/persona-requests/{id}` currently answers. */
  requestStatus: string;
  close(): Promise<void>;
};

const CATALOG = [
  { key: "github", name: "github", description: "Read repositories, open issues and pull requests, review code" },
  { key: "linear", name: "linear", description: "Create and triage Linear issues and projects" },
];

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function startMockPersonasBridge(): Promise<MockPersonasBridge> {
  const apiKey = `pk_mock_${Math.random().toString(36).slice(2, 10)}`;
  // nonce -> how many times it has been claimed. The FIRST claim is always
  // "pending" (the human has not approved yet); the second hands the key over
  // and spends the nonce, exactly as the real single-use claim does.
  const claims = new Map<string, number>();
  let requestSeq = 0;
  // Every accepted persona request id, so a poll for an id this mock never
  // issued 404s rather than answering the ladder for a stranger.
  const issued = new Set<string>();

  const state: MockPersonasBridge = {
    url: "",
    apiKey,
    pairRequests: [],
    claimAttempts: 0,
    dispatches: [],
    lastDispatch: () => state.dispatches[state.dispatches.length - 1] ?? null,
    unauthorizedCalls: 0,
    unknownPaths: [],
    requestStatus: "pending_approval",
    setRequestStatus(status, persona) {
      state.requestStatus = status;
      if (persona?.id !== undefined) personaId = persona.id;
      if (persona?.name !== undefined) personaName = persona.name;
    },
    close: async () => undefined,
  };
  let personaId = "persona-mock-1";
  let personaName = "kp App master";

  /** The Bearer gate every /api/kp/* route runs. */
  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization ?? "";
    if (header === `Bearer ${apiKey}`) return true;
    state.unauthorizedCalls += 1;
    return false;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "GET" && path === "/health") {
        json(res, 200, { status: "ok", management: true });
        return;
      }

      // ---- pairing (bare bodies, no envelope) -----------------------------
      if (method === "POST" && path === "/pair/request") {
        const body = await readJson(req);
        // The REAL bridge reads the pairing origin from the Origin header and
        // refuses without it — the mock enforces the same so a server-side
        // caller that forgets the header fails HERE, not first in production.
        // (Sweep #2 2026-08-24: kp's own pairing.ts had exactly that bug.)
        if (!req.headers.origin) {
          json(res, 400, { error: "Origin header required" });
          return;
        }
        const nonce = typeof body.nonce === "string" ? body.nonce : "";
        // The real side keys its pending entry by a ≥16-char nonce kp mints; a
        // shorter one would be a kp-side entropy regression, so refuse it.
        if (nonce.length < 16) {
          json(res, 400, { error: "nonce must be at least 16 characters" });
          return;
        }
        state.pairRequests.push({ nonce, scopes: body.scopes, client: body.client });
        claims.set(nonce, 0);
        json(res, 200, { ok: true, expiresInS: 300 });
        return;
      }

      if (method === "GET" && path === "/pair/claim") {
        state.claimAttempts += 1;
        const nonce = url.searchParams.get("nonce") ?? "";
        const seen = claims.get(nonce);
        // Unknown nonce (or one already spent) — the real claim is single-use.
        if (seen === undefined) {
          json(res, 404, { error: "unknown or spent nonce" });
          return;
        }
        if (seen === 0) {
          claims.set(nonce, 1);
          // A 200 carrying no key: "the human has not approved yet". kp reads
          // this shape as pending (pairing.ts), and so must this mock's peer.
          json(res, 200, { status: "pending" });
          return;
        }
        claims.delete(nonce); // spent
        // The REAL bridge answers { token } (probed 2026-08-24) — the mock pins
        // the real shape so a reader expecting apiKey/key fails HERE first.
        json(res, 200, { token: apiKey });
        return;
      }

      // ---- management API (ApiResult envelope, Bearer-gated) --------------
      if (method === "GET" && path === "/api/kp/connector-catalog") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        json(res, 200, { success: true, data: { connectors: CATALOG } });
        return;
      }

      if (method === "POST" && path === "/api/kp/persona-requests") {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const body = await readJson(req);
        const requestId = `req-mock-${++requestSeq}`;
        issued.add(requestId);
        state.dispatches.push({
          authorization: req.headers.authorization ?? null,
          kp: (body.kp ?? {}) as RecordedDispatch["kp"],
          spec: (body.spec ?? {}) as RecordedDispatch["spec"],
          reportToken: typeof body.reportToken === "string" ? body.reportToken : "",
          // Deliberately kept as `unknown`: the test parses it with the real
          // appMasterSpecSchema, which is the assertion that matters.
          ...(body.appMaster !== undefined ? { appMaster: body.appMaster } : {}),
          requestId,
        });
        json(res, 200, { success: true, data: { requestId } });
        return;
      }

      const statusMatch = /^\/api\/kp\/persona-requests\/([^/]+)$/.exec(path);
      if (method === "GET" && statusMatch) {
        if (!authorized(req)) {
          json(res, 401, { success: false, error: "missing or invalid bearer token" });
          return;
        }
        const requestId = decodeURIComponent(statusMatch[1]);
        if (!issued.has(requestId)) {
          json(res, 404, { success: false, error: "unknown request" });
          return;
        }
        json(res, 200, {
          success: true,
          data: {
            status: state.requestStatus,
            // The persona identity only exists once the human approved it —
            // before that, null, so kp cannot render a name nobody assigned.
            personaId: state.requestStatus === "pending_approval" ? null : personaId,
            personaName: state.requestStatus === "pending_approval" ? null : personaName,
          },
        });
        return;
      }

      state.unknownPaths.push(`${method} ${path}`);
      json(res, 404, { error: "no such route on the mock Personas bridge" });
    })().catch(() => {
      // Never leave a socket hanging: an unexpected throw here would surface on
      // the kp side as a 5s timeout, which reads as "Personas is down" and
      // hides the real cause.
      if (!res.headersSent) json(res, 500, { error: "mock bridge failed" });
      else res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return state;
}
