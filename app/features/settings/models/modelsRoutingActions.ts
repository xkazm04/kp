// Fetch wrappers for the routing table's save/reset actions. Split out of
// ModelsRoutingRow.tsx (formerly RoutingRow in ModelsTab.tsx) so the row
// component carries less inline fetch plumbing. The test canary stays in the
// row itself — its success message is built from translated, parameterized
// strings that don't lend themselves to a provider-agnostic wrapper.
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";

export type RoutingActionResult =
  | { ok: true; rows: LlmConfigRow[] }
  | { ok: false; message: string };

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
  fallbackMessage: string,
  errMsg: ErrorMessageResolver
): Promise<RoutingActionResult> {
  try {
    const r = await fetch("/api/llm/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useCase, provider, model: model.trim() || null, params: params ?? {} }),
    });
    const p = (await r.json().catch(() => ({}))) as { rows?: LlmConfigRow[]; error?: string; code?: string };
    if (!r.ok || !p.rows) throw new Error(errMsg(p, fallbackMessage));
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
