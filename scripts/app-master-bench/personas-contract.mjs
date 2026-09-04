// The ONE contract the two Personas doubles are held to.
//
// There are two hand-written stand-ins for the Personas management API in this
// repo, and they were kept in sync by a comment:
//
//   e2e/fixtures/mock-personas-bridge.ts   — for the Playwright hire journey
//   scripts/app-master-bench/stub.mjs      — for the bench driver, in-process
//
// stub.mjs's header says it "is a port of e2e/fixtures/mock-personas-bridge.ts".
// Nothing checked that claim. Two ports of one contract, each free to drift from
// the real bridge in a different direction, with the drift only ever surfacing
// as a green double and a red production call — which is the exact failure mode
// a double exists to prevent.
//
// This module is the third thing both answer to. It is derived from the REAL
// callers, not from either double:
//
//   app/_lib/agent-hire/pairing.ts        POST /pair/request, GET /pair/claim
//   app/_lib/agent-hire/bridge-client.ts  GET  /api/kp/connector-catalog
//                                         POST /api/kp/persona-requests
//                                         GET  /api/kp/persona-requests/{id}
//   (+ GET /health, the reachability probe both doubles answer)
//
// It is a CONFORMANCE PROBE, not a schema: `checkContract(baseUrl)` drives a
// live double through the sequence kp itself walks — including the refusals,
// which are half the contract (an unauthenticated management call, a claim for
// an unregistered nonce, a poll for a request id nobody issued) — and returns a
// list of findings. Zero findings is conformance.
//
// The two doubles are NOT identical, and pretending otherwise would be its own
// lie. Every difference is declared in DECLARED_DIVERGENCES below, asserted to
// still be true in BOTH directions, and explained. A difference that is not
// declared is drift.

/** Where the shapes below come from, so a reader can re-derive them. */
export const CONTRACT_SOURCES = ["app/_lib/agent-hire/pairing.ts", "app/_lib/agent-hire/bridge-client.ts"];

/** The connector catalog both doubles serve — same two rows, same field names. */
export const CONTRACT_CONNECTOR_KEYS = ["github", "linear"];

/**
 * The differences between the two doubles that are DELIBERATE.
 *
 * `probe` names the field of a `checkContract` observation that carries the
 * difference, so a test can assert the divergence is still real in both
 * directions — a mock that silently starts auto-approving, or a stub that
 * silently grows a human beat, fails here rather than in a bench run whose
 * numbers nobody can explain afterwards.
 */
export const DECLARED_DIVERGENCES = [
  {
    id: "claim-ladder",
    probe: "claimsToToken",
    mock: 2,
    stub: 1,
    why:
      'GET /pair/claim. The desktop app\'s claim is gated on a HUMAN pressing approve, so the mock answers ' +
      '200 {status:"pending"} first and hands the token over on the second poll — that ladder is what kp\'s ' +
      "pairing poll is written against. The bench stub runs Personas in HEADLESS BRIDGE mode " +
      "(PERSONAS_HEADLESS_BRIDGE=1), where there is no human and the first claim hands the key over. Both are " +
      "real bridge behaviours; which one you get is a launch flag, not a version. A reader who conflates them " +
      "concludes the bench proved the pairing WAIT, which it never touches.",
  },
  {
    id: "headless-flag",
    probe: "headlessBridge",
    mock: undefined,
    stub: true,
    why:
      "GET /health. `headlessBridge` is the flag the soak runner reads to decide whether Personas can be driven " +
      "unattended (scripts/app-master-bench/soak/night.mjs step 1). The stub models a headless bridge and says " +
      "so; the mock models the operator's desktop window and omits the field, exactly as a non-headless bridge " +
      "does. Absent and false are the same answer to the soak runner, and deliberately different answers here.",
  },
  {
    id: "status-ladder-driver",
    probe: "statusAfterDispatch",
    mock: "pending_approval",
    stub: "active",
    why:
      "GET /api/kp/persona-requests/{id}. The mock's ladder is driven by the TEST (setRequestStatus), so a fresh " +
      "request sits at pending_approval until the spec walks it forward — that is what the e2e journey asserts kp " +
      "renders. The stub auto-executes the build, so the request is already active when kp first polls: a bench " +
      "night cannot wait on a human. Same field, same vocabulary, different driver.",
  },
];

/** A nonce kp would mint: ≥16 chars (pairing.ts), unique per probe. */
const nonce = () => `bench-contract-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const ORIGIN = "http://kp-personas-contract.localhost";

async function call(baseUrl, routePath, { method = "GET", token = null, origin = null, body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (body !== null) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON body is itself a finding; the caller reads it off `text`.
    parsed = null;
  }
  return { status: res.status, json: parsed, text };
}

/**
 * Drive one live double through the whole contract.
 *
 * @param baseUrl `http://127.0.0.1:<port>` of a running double
 * @returns { findings, observations } — zero findings is conformance;
 *          `observations` carries the values DECLARED_DIVERGENCES is checked against.
 */
export async function checkContract(baseUrl) {
  const findings = [];
  const observations = { claimsToToken: null, headlessBridge: undefined, statusAfterDispatch: null };
  const want = (ok, message) => {
    if (!ok) findings.push(message);
  };

  // ---- reachability -------------------------------------------------------
  const health = await call(baseUrl, "/health");
  want(health.status === 200, `GET /health answered ${health.status}, want 200`);
  want(health.json?.status === "ok", `GET /health body.status is ${JSON.stringify(health.json?.status)}, want "ok"`);
  want(
    health.json?.management === true,
    "GET /health must report management:true — it is how kp knows the management API is mounted",
  );
  observations.headlessBridge = health.json?.headlessBridge;

  // ---- pairing: the refusals first ----------------------------------------
  // pairing.ts sends the Origin header and the real bridge binds the key to it;
  // a caller that forgets it must fail against the double, not in production.
  const noOrigin = await call(baseUrl, "/pair/request", {
    method: "POST",
    body: { nonce: nonce(), scopes: [], client: {} },
  });
  want(noOrigin.status === 400, `POST /pair/request without Origin answered ${noOrigin.status}, want 400`);

  const shortNonce = await call(baseUrl, "/pair/request", {
    method: "POST",
    origin: ORIGIN,
    body: { nonce: "short", scopes: [], client: {} },
  });
  want(
    shortNonce.status === 400,
    `POST /pair/request with a <16-char nonce answered ${shortNonce.status}, want 400 — an entropy regression on the kp side must fail here`,
  );

  const strangerClaim = await call(baseUrl, `/pair/claim?nonce=${encodeURIComponent(nonce())}`);
  want(
    strangerClaim.status === 404,
    `GET /pair/claim for an unregistered nonce answered ${strangerClaim.status}, want 404`,
  );

  // ---- pairing: the happy path --------------------------------------------
  const registered = nonce();
  const paired = await call(baseUrl, "/pair/request", {
    method: "POST",
    origin: ORIGIN,
    body: { nonce: registered, scopes: ["kp"], client: { name: "kp contract probe" } },
  });
  want(paired.status === 200, `POST /pair/request answered ${paired.status}, want 200`);
  want(
    paired.json?.ok === true,
    "POST /pair/request must answer a BARE {ok:true} — the pairing routes sit OUTSIDE Personas' ApiResult envelope",
  );

  // Poll the claim the way kp's UI does. How many polls a token takes is a
  // declared divergence, so it is measured here rather than asserted.
  let token = null;
  let claims = 0;
  while (claims < 5 && token === null) {
    claims += 1;
    const claim = await call(baseUrl, `/pair/claim?nonce=${encodeURIComponent(registered)}`);
    if (claim.status !== 200) {
      findings.push(`GET /pair/claim poll ${claims} answered ${claim.status}, want 200 — pending or token, never an error`);
      break;
    }
    if (typeof claim.json?.token === "string") {
      token = claim.json.token;
      observations.claimsToToken = claims;
      break;
    }
    want(
      claim.json?.status === "pending",
      `GET /pair/claim poll ${claims} answered neither a token nor {status:"pending"}: ${JSON.stringify(claim.json)}`,
    );
  }
  if (token === null) {
    findings.push("GET /pair/claim never handed a token over within 5 polls — the rest of the contract cannot be probed");
    return { findings, observations };
  }
  want(token.startsWith("pk_"), `the claimed key is "${token.slice(0, 6)}…", want a pk_ key`);

  // The real claim is single-use: a spent nonce must 404, not re-issue.
  const respend = await call(baseUrl, `/pair/claim?nonce=${encodeURIComponent(registered)}`);
  want(
    respend.status === 404,
    `GET /pair/claim for a SPENT nonce answered ${respend.status}, want 404 — the real claim is single-use`,
  );

  // ---- management API: the bearer gate ------------------------------------
  const catalogAnon = await call(baseUrl, "/api/kp/connector-catalog");
  want(
    catalogAnon.status === 401,
    `GET /api/kp/connector-catalog unauthenticated answered ${catalogAnon.status}, want 401`,
  );
  want(catalogAnon.json?.success === false, "a refused management call answers inside the envelope: {success:false, error}");

  const catalog = await call(baseUrl, "/api/kp/connector-catalog", { token });
  want(catalog.status === 200, `GET /api/kp/connector-catalog answered ${catalog.status}, want 200`);
  want(
    catalog.json?.success === true,
    "GET /api/kp/connector-catalog must answer inside the ApiResult envelope — bridge-client.ts unwraps {success, data}",
  );
  const connectors = catalog.json?.data?.connectors;
  want(Array.isArray(connectors), `data.connectors is ${typeof connectors}, want an array`);
  if (Array.isArray(connectors)) {
    for (const key of CONTRACT_CONNECTOR_KEYS) {
      want(
        connectors.some((c) => c?.key === key),
        `the catalog is missing the "${key}" connector both doubles serve`,
      );
    }
    for (const c of connectors) {
      want(
        typeof c?.key === "string" && typeof c?.name === "string" && typeof c?.description === "string",
        `a catalog row is missing key/name/description: ${JSON.stringify(c)}`,
      );
    }
  }

  // ---- dispatch -----------------------------------------------------------
  // kp.baseUrl points at a closed port on purpose: a double that tries to push a
  // report back must fail to reach anything rather than talk to a live server.
  const dispatchBody = {
    kp: { baseUrl: "http://127.0.0.1:1", jobId: "job-contract", jobTitle: "Contract probe", workspace: "w" },
    spec: {
      name: "contract probe",
      mission: "prove the contract",
      connectors: ["github"],
      maxBudgetUsd: 1,
      maxTurns: 1,
      successMetrics: [],
    },
    reportToken: "rt-contract-probe",
  };
  const dispatchAnon = await call(baseUrl, "/api/kp/persona-requests", { method: "POST", body: dispatchBody });
  want(dispatchAnon.status === 401, `POST /api/kp/persona-requests unauthenticated answered ${dispatchAnon.status}, want 401`);

  const dispatch = await call(baseUrl, "/api/kp/persona-requests", { method: "POST", token, body: dispatchBody });
  want(dispatch.status === 200, `POST /api/kp/persona-requests answered ${dispatch.status}, want 200`);
  want(dispatch.json?.success === true, "POST /api/kp/persona-requests answers inside the ApiResult envelope");
  const requestId = dispatch.json?.data?.requestId;
  want(
    typeof requestId === "string" && requestId.length > 0,
    `data.requestId is ${JSON.stringify(requestId)}, want a non-empty string`,
  );

  // ---- status poll --------------------------------------------------------
  if (typeof requestId === "string" && requestId.length > 0) {
    const statusAnon = await call(baseUrl, `/api/kp/persona-requests/${encodeURIComponent(requestId)}`);
    want(statusAnon.status === 401, `GET /api/kp/persona-requests/{id} unauthenticated answered ${statusAnon.status}, want 401`);

    const unknownId = await call(baseUrl, "/api/kp/persona-requests/req-nobody-issued", { token });
    want(
      unknownId.status === 404,
      `GET /api/kp/persona-requests/{unknown id} answered ${unknownId.status}, want 404 — a double that answers a ladder for a stranger hides a kp-side id bug`,
    );

    const status = await call(baseUrl, `/api/kp/persona-requests/${encodeURIComponent(requestId)}`, { token });
    want(status.status === 200, `GET /api/kp/persona-requests/{id} answered ${status.status}, want 200`);
    want(status.json?.success === true, "GET /api/kp/persona-requests/{id} answers inside the ApiResult envelope");
    const data = status.json?.data ?? {};
    want(
      typeof data.status === "string" && data.status.length > 0,
      `data.status is ${JSON.stringify(data.status)}, want a non-empty string`,
    );
    want(
      "personaId" in data && "personaName" in data,
      "the status body must carry personaId and personaName — null before a persona exists, never absent",
    );
    observations.statusAfterDispatch = typeof data.status === "string" ? data.status : null;
  }

  // ---- an unknown path is a 404, not a hang and not a 200 -----------------
  const strangerPath = await call(baseUrl, "/api/kp/definitely-not-a-route", { token });
  want(
    strangerPath.status === 404,
    `an unknown management path answered ${strangerPath.status}, want 404 — a kp-side path typo must surface here`,
  );

  return { findings, observations };
}
