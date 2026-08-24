// The stored shape of a companion proposal, and how to read one back safely.
//
// SPLIT OUT OF THE CATALOG ON PURPOSE. `companion-actions.ts` is the single
// source of truth for what actions EXIST and what accepting one does — and every
// `execute` there reaches the task runner, the pipeline store and the JD store,
// which sit on better-sqlite3. The dock renders a proposal card, so it needs the
// payload's SHAPE and nothing else; importing the catalog to get it would drag a
// server-only graph into the client bundle (a lazy `import()` is still a bundled
// chunk, not an escape hatch).
//
// So the split is by AUDIENCE, not by a second list: nothing here names an
// action, declares a parameter, or decides what anything does. It is the
// serialization contract of `companion_proposals.payload_json`, which both sides
// legitimately share. `companion-actions.ts` re-exports these types so a spec
// author never has to know this file exists.
//
// Dependency-free by construction (no db, no next/server, no catalog), the same
// rule `companion-turn.ts` and `companion-blocks.ts` follow.

/** Action parameters, always strings. A model writes values, and a value that is
 *  not text is a value the prompt could not have produced. */
export type CompanionActionParams = Record<string, string>;

/** What the dock renders above Accept / Decline. A catalog REFERENCE, never a
 *  sentence: a proposal row is written by a server with no reader attached and is
 *  read later by whoever has the dock open, in their language. Same contract as
 *  `task-label.ts`, for the same reason. Copy lives under `companion.action.*`. */
export type CompanionActionSummary = {
  key: string;
  values?: Record<string, string | number>;
};

/** What the dock renders after the operator answered. Also a reference; copy
 *  lives under `companion.outcome.*`. */
export type CompanionActionOutcome = {
  key: string;
  values?: Record<string, string | number>;
  /** The thing that now exists because of the accept — a task id, a JD slug, a
   *  pipeline entry id. Not rendered; it is the audit trail on the proposal row. */
  ref?: string;
};

/** The stored half of a proposal. `kind` on the row is the action id, so the row
 *  is legible without parsing the payload; the payload carries what the executor
 *  and the dock each need. */
export type CompanionProposalPayload = {
  actionId: string;
  params: CompanionActionParams;
  summary: CompanionActionSummary;
  /** Stamped by the resolve route once the operator answered. */
  outcome?: CompanionActionOutcome;
};

/** Bound on every param value. Long enough for a free-text hiring need, short
 *  enough that a runaway completion cannot write a novel into a proposal row. */
export const MAX_ACTION_PARAM_CHARS = 2_000;

function coerceValues(raw: unknown): Record<string, string | number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Read a stored payload back without trusting it: a row written by an older
 *  build, or by an action that has since been retired, must degrade to "I can no
 *  longer describe this" rather than to a confident wrong summary. Returns null
 *  only when there is no action id at all — everything else has a floor. */
export function coerceProposalPayload(raw: unknown): CompanionProposalPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const actionId = typeof record.actionId === "string" ? record.actionId : "";
  if (!actionId) return null;
  const params: CompanionActionParams = {};
  if (record.params && typeof record.params === "object" && !Array.isArray(record.params)) {
    for (const [key, value] of Object.entries(record.params as Record<string, unknown>)) {
      if (typeof value === "string") params[key] = value.slice(0, MAX_ACTION_PARAM_CHARS);
    }
  }
  const summaryRaw = record.summary as Record<string, unknown> | undefined;
  const summary: CompanionActionSummary =
    summaryRaw && typeof summaryRaw.key === "string" && summaryRaw.key
      ? { key: summaryRaw.key, values: coerceValues(summaryRaw.values) }
      : { key: "unknown" };
  const outcomeRaw = record.outcome as Record<string, unknown> | undefined;
  const outcome: CompanionActionOutcome | undefined =
    outcomeRaw && typeof outcomeRaw.key === "string" && outcomeRaw.key
      ? {
          key: outcomeRaw.key,
          values: coerceValues(outcomeRaw.values),
          ...(typeof outcomeRaw.ref === "string" ? { ref: outcomeRaw.ref } : {}),
        }
      : undefined;
  return { actionId, params, summary, ...(outcome ? { outcome } : {}) };
}
