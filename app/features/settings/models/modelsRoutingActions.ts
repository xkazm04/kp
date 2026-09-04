// Fetch wrappers for the routing table's save/reset actions. Split out of
// ModelsRoutingRow.tsx (formerly RoutingRow in ModelsTab.tsx) so the row
// component carries less inline fetch plumbing. The test canary stays in the
// row itself — its success message is built from translated, parameterized
// strings that don't lend themselves to a provider-agnostic wrapper.
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";

export type RoutingActionResult =
  | { ok: true; rows: LlmConfigRow[] }
  /** `rows` rides along on a REFUSAL that carries the current table - today only the
   *  409 MODEL_ROUTING_STALE. The caller applies them, so a save that lost the race
   *  leaves the operator looking at what is actually pinned rather than at their own
   *  dead draft. Absent on every other failure, where nothing new is known. */
  | { ok: false; message: string; rows?: LlmConfigRow[] };

/** PUT the pin for a use case. Params aren't editable here yet — pass the
 *  pinned row's through so a save never silently drops maxTokens/timeoutS set
 *  headlessly.
 *
 *  `errMsg` is the caller's bound resolver (this is a plain module, so it takes
 *  one instead of calling the hook): API failures are read from the machine
 *  `code`, never from the server's English `error` string. */
export async function saveRoutingPin(
  useCase: string,
  provider: string,
  model: string,
  params: Record<string, unknown> | undefined,
  /** The `updatedAt` of the row this edit was composed against, or null when the
   *  use case showed no pin. Echoed back so the store can re-assert it and DROP a
   *  save that another operator's write has since superseded (MODEL_ROUTING_STALE). */
  expectedUpdatedAt: string | null,
  fallbackMessage: string,
  errMsg: ErrorMessageResolver
): Promise<RoutingActionResult> {
  try {
    const r = await fetch("/api/llm/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        useCase,
        provider,
        model: model.trim() || null,
        params: params ?? {},
        expectedUpdatedAt,
      }),
    });
    const p = (await r.json().catch(() => ({}))) as { rows?: LlmConfigRow[]; error?: string; code?: string };
    // A 409 answers WITH the current rows. Read them off the refusal before the
    // throw, so the row can reload the table alongside the message.
    if (!r.ok || !p.rows) {
      const message = errMsg(p, fallbackMessage);
      return p.code === "MODEL_ROUTING_STALE" && p.rows
        ? { ok: false, message, rows: p.rows }
        : { ok: false, message };
    }
    return { ok: true, rows: p.rows };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : fallbackMessage };
  }
}

export async function resetRoutingPin(
  useCase: string,
  fallbackMessage: string,
  errMsg: ErrorMessageResolver
): Promise<RoutingActionResult> {
  try {
    const r = await fetch("/api/llm/config", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useCase }),
    });
    const p = (await r.json().catch(() => ({}))) as { rows?: LlmConfigRow[]; error?: string; code?: string };
    if (!r.ok || !p.rows) throw new Error(errMsg(p, fallbackMessage));
    return { ok: true, rows: p.rows };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : fallbackMessage };
  }
}
