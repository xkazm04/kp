import {
  BRIDGE_TIMEOUT_MS,
  isRedirectResponse,
  readBridgeJson,
  resolveBridgeOrFail,
  AGENT_BRIDGE_KEY_UNREADABLE,
} from "../agent-hire/bridge-client";
import { markBridgeOk } from "../agent-hire/bridge-store";
import type { GigAssignment } from "./types";

// The two Personas management-API calls a gig attempt needs, on kp's paired bridge
// (bridge-client.ts owns the base URL, the pk_ key, the 5s deadline, the bounded body
// read and the no-redirect rule - this module reuses all of them):
//
//   POST {bridge}/api/execute/{personaId}   body {input_data: GigAssignment}
//        -> {success, data: {execution_id, status: "queued"}}
//   GET  {bridge}/api/executions/{id}
//        -> {success, data: PersonaExecution}   (snake_case: status, output_data, cost_usd)
//
// Source: personas src-tauri/src/engine/management_api.rs (execute_persona, get_execution)
// and src-tauri/core/src/models/execution.rs (PersonaExecution, no serde rename). Status
// words are ExecutionState in core/src/types.rs: queued | running | completed | failed |
// incomplete | cancelled (+ the legacy alias pending -> queued).
//
// Every failure is a REASON CODE (a short snake_case string stored on the attempt as
// `fallback_reason`), never a thrown error and never a fabricated execution id.
//
// SCOPE GAP, stated where it bites: kp's paired key holds `personas:read` +
// `personas:build` (PAIRING_SCOPES, agent-hire/pairing.ts). `/api/execute/{id}` needs
// `personas:execute` or `personas:execute:persona:{id}`, so until Personas grants the
// per-persona scope on hire approval every execute answers 403 - mapped to
// `personas_scope_missing` so the operator sees exactly why. The GET needs only
// authentication.

export type ExecuteFailureReason =
  | "personas_unpaired"
  | "personas_key_unreadable"
  | "personas_key_invalid"
  | "personas_scope_missing"
  | "personas_persona_missing"
  | "personas_persona_disabled"
  | "personas_redirect"
  | "personas_unreachable"
  | "personas_response_too_large"
  | "personas_no_execution_id"
  | `personas_http_${number}`;

export type ExecutePersonaResult = { ok: true; executionId: string } | { ok: false; reason: ExecuteFailureReason; status?: number };

/** A Personas execution as the sync step reads it. */
export type GigExecutionSnapshot = {
  /** Lower-cased ExecutionState word as Personas sent it. */
  status: string;
  outputData: string | null;
  /** Metered spend; null when Personas did not report one. */
  costUsd: number | null;
  errorMessage: string | null;
};

export type FetchExecutionResult =
  | { ok: true; execution: GigExecutionSnapshot }
  | {
      ok: false;
      reason: ExecuteFailureReason | "personas_execution_missing" | "personas_bad_response";
      /** True when trying again later can succeed (Personas down, key expired). */
      retryable: boolean;
      status?: number;
    };

function headers(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

/** Personas wraps payloads in `{success, data}`; a bare body passes through. Never throws
 *  (bridge-client's own unwrap throws on `success:false`, which a status-aware caller
 *  here does not want). */
function envelopeData(body: unknown): unknown {
  if (body && typeof body === "object" && "success" in body) {
    const env = body as { success?: unknown; data?: unknown };
    return env.success === true ? env.data : null;
  }
  return body;
}

function statusReason(status: number): ExecuteFailureReason {
  if (status === 401) return "personas_key_invalid";
  if (status === 403) return "personas_scope_missing";
  return `personas_http_${status}`;
}

function transportReason(): "personas_unreachable" {
  return "personas_unreachable";
}

type Bridge = { baseUrl: string; apiKey: string };

function bridgeOrReason(): { ok: true; bridge: Bridge } | { ok: false; reason: "personas_unpaired" | "personas_key_unreadable" } {
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) {
    return { ok: false, reason: resolved.failure.code === AGENT_BRIDGE_KEY_UNREADABLE ? "personas_key_unreadable" : "personas_unpaired" };
  }
  if (!resolved.bridge.apiKey) return { ok: false, reason: "personas_unpaired" };
  return { ok: true, bridge: { baseUrl: resolved.bridge.baseUrl, apiKey: resolved.bridge.apiKey } };
}

/** POST the assignment to the persona. The assignment rides as `input_data` - DATA the
 *  persona reads, not text spliced into its prompt. */
export async function executePersonaForGig(personaId: string, assignment: GigAssignment): Promise<ExecutePersonaResult> {
  const b = bridgeOrReason();
  if (!b.ok) return { ok: false, reason: b.reason };
  try {
    const r = await fetch(`${b.bridge.baseUrl}/api/execute/${encodeURIComponent(personaId)}`, {
      method: "POST",
      headers: headers(b.bridge.apiKey),
      body: JSON.stringify({ input_data: assignment }),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (isRedirectResponse(r)) return { ok: false, reason: "personas_redirect" };
    if (r.status === 404) return { ok: false, reason: "personas_persona_missing", status: 404 };
    if (r.status === 400) return { ok: false, reason: "personas_persona_disabled", status: 400 };
    if (!r.ok) return { ok: false, reason: statusReason(r.status), status: r.status };
    const read = await readBridgeJson<unknown>(r);
    if (!read.ok) return { ok: false, reason: "personas_response_too_large" };
    const data = envelopeData(read.value) as { execution_id?: unknown; executionId?: unknown; id?: unknown } | null;
    const id = [data?.execution_id, data?.executionId, data?.id].find((v): v is string => typeof v === "string" && v.trim() !== "");
    if (!id) return { ok: false, reason: "personas_no_execution_id" };
    markBridgeOk();
    return { ok: true, executionId: id.trim() };
  } catch {
    // Timeout, refused connection, DNS: Personas is not answering. The attempt fails with
    // a reason; the error text (a stack-bearing undici message) is not the operator's.
    return { ok: false, reason: transportReason() };
  }
}

function finiteCost(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** GET one execution. */
export async function fetchPersonaExecution(executionId: string): Promise<FetchExecutionResult> {
  const b = bridgeOrReason();
  if (!b.ok) return { ok: false, reason: b.reason, retryable: true };
  try {
    const r = await fetch(`${b.bridge.baseUrl}/api/executions/${encodeURIComponent(executionId)}`, {
      headers: headers(b.bridge.apiKey),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (isRedirectResponse(r)) return { ok: false, reason: "personas_redirect", retryable: true };
    if (r.status === 404) return { ok: false, reason: "personas_execution_missing", retryable: false, status: 404 };
    // 403 is not retryable: a scope is granted by an operator in Personas, not by time.
    if (r.status === 403) return { ok: false, reason: "personas_scope_missing", retryable: false, status: 403 };
    if (!r.ok) return { ok: false, reason: statusReason(r.status), retryable: true, status: r.status };
    const read = await readBridgeJson<unknown>(r);
    if (!read.ok) return { ok: false, reason: "personas_response_too_large", retryable: false };
    const data = envelopeData(read.value) as Record<string, unknown> | null;
    const status = data && typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
    if (!status) return { ok: false, reason: "personas_bad_response", retryable: true };
    markBridgeOk();
    return {
      ok: true,
      execution: {
        status,
        outputData: typeof data!.output_data === "string" ? data!.output_data : null,
        costUsd: finiteCost(data!.cost_usd),
        errorMessage: typeof data!.error_message === "string" ? data!.error_message : null,
      },
    };
  } catch {
    // Unreachable Personas: the attempt keeps its state and the next sync asks again.
    return { ok: false, reason: transportReason(), retryable: true };
  }
}
