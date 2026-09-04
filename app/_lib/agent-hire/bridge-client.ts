import { readTextWithLimit } from "../request-body";
import { markBridgeOk, resolveBridge, type ResolvedBridge } from "./bridge-store";

// Personas bridge client (WP1) — server-side fetch helpers, NEVER from the
// browser: the pk_ key rides every call as a bearer header.
//
// SSRF note: the target is LOOPBACK BY DESIGN (Personas is a local desktop app
// on http://127.0.0.1:9420), so this module deliberately does NOT run
// assertDeliverableWebhookUrl — that guard exists to keep server egress off
// private ranges, which is exactly where this integration lives. The URL comes
// only from operator config / env, never from request input.
//
// Error model (the ats-egress deliver() contract): every helper returns a
// structured `{ok, ...} | {ok:false, error, status?}` result and NEVER throws to
// the route; all calls carry a 5s AbortSignal timeout.
//
// `redirect: "manual"` on every call, same reasoning as ats-egress.deliver():
// "loopback by design" describes the URL WE DIAL, and with the default `follow`
// undici re-dials whatever the answer points at. A 307/308 replays method AND
// body — and the dispatch body carries `reportToken`, the ONLY auth on the public
// POST /api/agents/report/[token] route, plus kp's own base URL. Whoever received
// that replay could move the agent to Hired and post fabricated spend with no
// session. Not following also matches what the local app actually does (a JSON
// management API never redirects).

/** The one bridge deadline. Exported because `pairing.ts` dials the SAME local app
 *  over the same two phases and had declared its own `TIMEOUT_MS = 5_000` beside
 *  this one — two constants for one property, which is how a tuned timeout ends up
 *  applying to three of five calls. */
export const BRIDGE_TIMEOUT_MS = 5_000;

/** Every bridge RESPONSE is read under this cap. Personas is a local app kp trusts
 *  to be running, not to be well-behaved: `await r.json()` buffers whatever the
 *  socket sends, so a wedged or hostile process on 127.0.0.1:9420 could stream
 *  gigabytes into the Node heap of a route that has already passed its own body
 *  cap. 256 KiB is ~4x the largest real payload here (a full connector catalog);
 *  the same number the public report door uses on the way in. */
export const MAX_BRIDGE_BODY_BYTES = 256 * 1024;

export type BridgeFailure = { ok: false; error: string; status?: number; code?: string };

/** A bridge body that blew the cap. Its own reason rather than a generic parse
 *  failure: "Personas sent more than kp will read" is an operator-actionable fact
 *  about the OTHER side, not a malformed-response guess. */
export const AGENT_BRIDGE_RESPONSE_TOO_LARGE = "AGENT_BRIDGE_RESPONSE_TOO_LARGE";

export const BRIDGE_RESPONSE_TOO_LARGE_MESSAGE =
  `Personas answered with more than kp will read (${Math.round(MAX_BRIDGE_BODY_BYTES / 1024)} KB). The response was dropped unread — check the Personas app version.`;

export type BridgeBody<T> = { ok: true; value: T | null } | { ok: false; reason: "too_large" };

/**
 * The bounded read every bridge call goes through, in place of `await r.json()`.
 * Structured on purpose — three outcomes, none of them a throw:
 *   • over budget → `{ok:false, reason:"too_large"}`, and the caller answers with
 *     `AGENT_BRIDGE_RESPONSE_TOO_LARGE` (or, for the catalog, degrades to builtin).
 *   • absent / not JSON → `{ok:true, value:null}`, which is exactly what the old
 *     `.catch(() => null)` produced, so each caller's own shape refusal still runs.
 *   • otherwise → the parsed value.
 */
export async function readBridgeJson<T>(r: Response): Promise<BridgeBody<T>> {
  const raw = await readTextWithLimit(r, MAX_BRIDGE_BODY_BYTES);
  if (raw === null) return { ok: false, reason: "too_large" };
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: (JSON.parse(raw) ?? null) as T | null };
  } catch {
    // Not JSON at all — the same answer as an empty body, refused by the caller's
    // own shape check rather than by a parser message the operator cannot act on.
    return { ok: true, value: null };
  }
}

/** `readBridgeJson`'s over-budget outcome, as the module's structured failure. */
function tooLargeFailure(): BridgeFailure {
  return { ok: false, code: AGENT_BRIDGE_RESPONSE_TOO_LARGE, error: BRIDGE_RESPONSE_TOO_LARGE_MESSAGE };
}

function failure(e: unknown): BridgeFailure {
  if (e instanceof Error && e.name === "TimeoutError") return { ok: false, error: "Personas did not respond within 5s." };
  return { ok: false, error: e instanceof Error ? e.message : "Personas request failed." };
}

/** A dead pairing key, told apart from every other bridge failure.
 *
 *  Personas' headless auto-pair mints keys that LIVE 24 HOURS, and an expired
 *  one answers 401 to every call. That is not "Personas is down" and not "the
 *  request was wrong": nothing is broken except the credential, and the fix is
 *  one re-pair in Settings → Integrations. Reporting it as a generic
 *  `AGENT_DISPATCH_BRIDGE_FAILED` (which is what the 2026-08-25 sweep saw —
 *  `502 Personas responded 401` — and what an operator would read as an outage)
 *  sends the reader looking for a server that is in fact running fine. */
export const AGENT_BRIDGE_KEY_INVALID = "AGENT_BRIDGE_KEY_INVALID";

export const BRIDGE_KEY_INVALID_MESSAGE =
  "Personas rejected kp's API key (401) — the pairing key has expired or been revoked. Re-pair in Settings → Integrations.";

/** Turn a non-2xx from Personas into a failure, naming a dead key as one. */
function upstreamFailure(status: number): BridgeFailure {
  if (status === 401) {
    return { ok: false, status, code: AGENT_BRIDGE_KEY_INVALID, error: BRIDGE_KEY_INVALID_MESSAGE };
  }
  return { ok: false, status, error: `Personas responded ${status}.` };
}

/** The stored pk_ key is held encrypted at rest, so `resolveBridge()` THROWS
 *  when it cannot be read back — KP_SECRET unset or rotated since pairing, or a
 *  corrupt ciphertext. Every helper below therefore resolves through here, for
 *  two reasons:
 *
 *   1. The module contract at the top of this file — "every helper returns a
 *      structured result and NEVER throws to the route" — was only true of the
 *      fetch. `resolveBridge()` sat OUTSIDE the try in the two helpers that
 *      dispatch and poll, so an unreadable key threw straight past the error
 *      model and out of the route.
 *   2. The message it throws talks about the *ATS webhook signing secret* — a
 *      feature the operator was not using. That is the same wrong-error trap
 *      `pairing.ts` guards at both pairing phases (see PAIR_NO_SECRET_ERROR);
 *      the client half was never wired, so a hire failed with an ATS sentence. */
export const AGENT_BRIDGE_KEY_UNREADABLE = "AGENT_BRIDGE_KEY_UNREADABLE";

export const BRIDGE_KEY_UNREADABLE_MESSAGE =
  "kp cannot read the stored Personas key: KP_SECRET (or KP_ATS_SECRET_KEY) is unset or has changed since pairing. Restore the secret, or re-pair in Settings → Integrations.";

export type ResolveBridgeResult = { ok: true; bridge: ResolvedBridge } | { ok: false; failure: BridgeFailure };

export function resolveBridgeOrFail(): ResolveBridgeResult {
  try {
    return { ok: true, bridge: resolveBridge() };
  } catch {
    return { ok: false, failure: { ok: false, code: AGENT_BRIDGE_KEY_UNREADABLE, error: BRIDGE_KEY_UNREADABLE_MESSAGE } };
  }
}

/** A `redirect:"manual"` 3xx surfaces as an opaque-redirect response (fetch spec:
 *  type "opaqueredirect", status 0, ok false). Shared with pairing.ts. */
export function isRedirectResponse(r: Response): boolean {
  return r.type === "opaqueredirect" || r.status === 0 || (r.status >= 300 && r.status < 400);
}

export const REDIRECT_ERROR =
  "Personas answered with a redirect; redirects are not followed — point the bridge URL at the Personas app itself.";

function headers(apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export type ConnectorCatalogEntry = { name: string; description: string };

// Built-in fallback catalog. GET {baseUrl}/api/personas lists personas, NOT
// connectors; the dedicated catalog route (/api/kp/connector-catalog) is a
// Personas WP3 deliverable that may not exist yet — a 404/failure there degrades
// to this static list of common connectors so the keyless/offline transform
// still produces a real spec (degrading without the bridge is a product
// property, same as degrading without API keys).
export const BUILTIN_CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { name: "gmail", description: "Send and read email, manage labels and threads" },
  { name: "slack", description: "Post and read messages in Slack channels and DMs" },
  { name: "github", description: "Read repositories, open issues and pull requests, review code" },
  { name: "jira", description: "Create and update Jira issues, sprints and boards" },
  { name: "notion", description: "Read and write Notion pages and databases" },
  { name: "google-calendar", description: "Read availability, create and update calendar events" },
  { name: "google-drive", description: "Read, create and organize documents and files" },
  { name: "linear", description: "Create and triage Linear issues and projects" },
  { name: "confluence", description: "Read and author Confluence documentation pages" },
  { name: "teams", description: "Post and read messages in Microsoft Teams" },
  { name: "discord", description: "Post and read messages in Discord servers" },
  { name: "http-api", description: "Call arbitrary HTTP/REST APIs with structured requests" },
  { name: "postgres", description: "Run read/write SQL against a PostgreSQL database" },
  { name: "sheets", description: "Read and update Google Sheets spreadsheets" },
  { name: "web-scraper", description: "Fetch and extract structured data from web pages" },
];

/** Personas' management API wraps every payload in its file-wide ApiResult
 *  envelope `{success, data}` / `{success:false, error}`. Unwrap it when
 *  present, pass bare bodies through untouched — the client stays compatible
 *  with both shapes (and with a future flattening on the Personas side). */
function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === "object" && "success" in body) {
    const env = body as { success?: unknown; data?: unknown; error?: unknown };
    if (env.success === true) return env.data;
    if (env.success === false) {
      const msg = typeof env.error === "string" && env.error ? env.error : "Personas reported an error.";
      throw new Error(msg);
    }
  }
  return body;
}

export type ConnectorCatalogResult = {
  ok: true;
  connectors: ConnectorCatalogEntry[];
  /** "personas" when the live catalog served; "builtin" for the static fallback. */
  source: "personas" | "builtin";
};

/** The connector catalog for the transform. Never fails: any bridge error
 *  (unpaired, down, or the route not shipped yet) falls back to the built-in list. */
export async function fetchConnectorCatalog(): Promise<ConnectorCatalogResult> {
  try {
    const bridge = resolveBridge();
    const r = await fetch(`${bridge.baseUrl}/api/kp/connector-catalog`, {
      headers: headers(bridge.apiKey),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (r.ok) {
      // A catalog that blows the cap is treated exactly like a catalog that failed:
      // this helper never fails, it degrades to the built-in list (and says so).
      const read = await readBridgeJson<unknown>(r);
      if (!read.ok) return { ok: true, connectors: BUILTIN_CONNECTOR_CATALOG, source: "builtin" };
      const body = unwrapEnvelope(read.value) as { connectors?: unknown } | unknown[];
      const list = Array.isArray(body) ? body : Array.isArray((body as { connectors?: unknown }).connectors) ? ((body as { connectors: unknown[] }).connectors) : [];
      const connectors = list
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        // Personas entries carry {key, name, description}; the display name is
        // what the recruiter sees and what rides the dispatch spec.
        .map((c) => ({ name: String(c.name ?? c.key ?? "").trim(), description: String(c.description ?? "").trim() }))
        .filter((c) => c.name);
      if (connectors.length > 0) {
        markBridgeOk();
        return { ok: true, connectors, source: "personas" };
      }
    }
  } catch {
    /* fall through to the built-in list */
  }
  return { ok: true, connectors: BUILTIN_CONNECTOR_CATALOG, source: "builtin" };
}

export type DispatchSpec = {
  name: string;
  mission: string;
  systemPromptDraft: string;
  connectors: string[];
  maxBudgetUsd: number | null;
  maxTurns?: number | null;
  successMetrics: unknown[];
};

export type KpLink = {
  baseUrl: string;
  jobId: string;
  jobTitle: string;
  workspace: string;
  /** App master only (P4): the role_intakes row the spec was composed in. An
   *  App-master hire owns an application rather than filling a job posting, so
   *  `jobId` is empty for it and this is the handle that resolves. Optional and
   *  additive — a Personas build that ignores it is unaffected. */
  intakeId?: string;
};

export type DispatchResult = { ok: true; requestId: string } | BridgeFailure;

/** POST the persona request to Personas. `reportToken` is the capability the
 *  hired persona will report back with (the /api/agents/report/[token] route).
 *
 *  `appMaster` is the P4 addition to the wire contract — the AppMasterSpec
 *  exactly as codegen produces it (appMasterSpecSchema). It rides BESIDE `spec`,
 *  never instead of it: `spec` is projected from `appMaster.agent`, so a
 *  Personas build that has not shipped the hire handler v2 still receives a
 *  complete, working flat spec and hires the persona as before. Its presence is
 *  the signal "this is an App-master hire". */
export async function dispatchPersonaRequest(
  spec: DispatchSpec,
  kp: KpLink,
  reportToken: string,
  appMaster?: unknown
): Promise<DispatchResult> {
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) return resolved.failure;
  const bridge = resolved.bridge;
  if (!bridge.apiKey) {
    return { ok: false, error: "Personas is not paired — no API key configured (pair first, or set PERSONAS_BRIDGE_KEY)." };
  }
  try {
    const r = await fetch(`${bridge.baseUrl}/api/kp/persona-requests`, {
      method: "POST",
      headers: headers(bridge.apiKey),
      body: JSON.stringify({ kp, spec, reportToken, ...(appMaster ? { appMaster } : {}) }),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    // Checked BEFORE `!r.ok`: a redirect is not an HTTP status to report back
    // (status 0), and it must never read as an acceptance of the hire.
    if (isRedirectResponse(r)) return { ok: false, error: REDIRECT_ERROR };
    if (!r.ok) return upstreamFailure(r.status);
    const read = await readBridgeJson<unknown>(r);
    if (!read.ok) return tooLargeFailure();
    const body = unwrapEnvelope(read.value) as { requestId?: unknown } | null;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    if (!requestId) return { ok: false, error: "Personas accepted the request but returned no requestId." };
    markBridgeOk();
    return { ok: true, requestId };
  } catch (e) {
    return failure(e);
  }
}

export type RequestStatusResult =
  | { ok: true; status: string; personaId: string | null; personaName: string | null }
  | BridgeFailure;

/** Poll fallback for a request's approval state (the push path is the report route). */
export async function fetchRequestStatus(requestId: string): Promise<RequestStatusResult> {
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) return resolved.failure;
  const bridge = resolved.bridge;
  if (!bridge.apiKey) return { ok: false, error: "Personas is not paired." };
  try {
    const r = await fetch(`${bridge.baseUrl}/api/kp/persona-requests/${encodeURIComponent(requestId)}`, {
      headers: headers(bridge.apiKey),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (isRedirectResponse(r)) return { ok: false, error: REDIRECT_ERROR };
    if (!r.ok) return upstreamFailure(r.status);
    const read = await readBridgeJson<unknown>(r);
    if (!read.ok) return tooLargeFailure();
    const body = unwrapEnvelope(read.value) as
      | { status?: unknown; personaId?: unknown; personaName?: unknown }
      | null;
    const status = typeof body?.status === "string" ? body.status : "";
    if (!status) return { ok: false, error: "Personas returned no request status." };
    markBridgeOk();
    return {
      ok: true,
      status,
      personaId: typeof body?.personaId === "string" ? body.personaId : null,
      personaName: typeof body?.personaName === "string" ? body.personaName : null,
    };
  } catch (e) {
    return failure(e);
  }
}
