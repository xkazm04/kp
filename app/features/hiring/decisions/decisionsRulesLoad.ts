// Shape guard for the Rules modal's config read.
//
// Why: the modal used to resolve a failed read with `.catch(() => setRule(FALLBACK))`
// and an empty body with `{ ...FALLBACK, ...(p.configs?.screening ?? {}) }` — so a
// 500, an offline fetch or a body that carried no screening config all rendered as
// the DEFAULT auto-reject thresholds, indistinguishable from the workspace's live
// rules. Saving from that screen would have written the defaults over whatever the
// team actually had. GET /api/decisions/config always answers with the effective
// screening rule (getAllDecisionConfigs fills every phase from DEFAULTS), so an
// absent or malformed one means the read did not work — never "no rule set".
import { SCREENING_DEFAULT, type ScreeningRule } from "@/app/_lib/decision-config-schema";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** The live screening rule from a GET /api/decisions/config body, or null when the
 *  payload does not carry one. Unknown extra fields (familyFloors, holdoutPercent…)
 *  ride through untouched — this guards the three fields the modal EDITS, and
 *  refuses to invent any of them. */
export function readScreeningRule(payload: unknown): ScreeningRule | null {
  if (!payload || typeof payload !== "object") return null;
  const screening = (payload as { configs?: { screening?: unknown } }).configs?.screening;
  if (!screening || typeof screening !== "object") return null;
  const s = screening as Partial<ScreeningRule>;
  if (typeof s.autoRejectEnabled !== "boolean") return null;
  if (!isFiniteNumber(s.rejectBottomPercent) || !isFiniteNumber(s.maxMatchToReject)) return null;
  return { ...SCREENING_DEFAULT, ...(s as ScreeningRule) };
}

/** Why a config read produced no rule, as the MACHINE half the route answered with.
 *
 *  gated-doors-clients-read-the-refusal: GET/POST /api/decisions/config are
 *  capability-gated now, so "the rules could not be read" has a reason a recruiter
 *  can act on - "your role does not allow this" is a different sentence from "the
 *  server fell over", and only one of them is worth retrying. This is a pure fold
 *  (no hook), so the modal that owns the translator resolves `code` through
 *  useErrorMessage and this module never holds a sentence. */
export type ScreeningRuleRead =
  | { rule: ScreeningRule; failure: null }
  | { rule: null; failure: { code: string | null; capability: string | null; status: number | null } };

/** Fold a config response into "the live rule" or "why not". `status` is null for a
 *  read that never reached the server (offline, aborted). */
export function readScreeningRuleResponse(status: number | null, payload: unknown): ScreeningRuleRead {
  const rule = readScreeningRule(payload);
  if (rule) return { rule, failure: null };
  const p = (payload ?? null) as { code?: unknown; capability?: unknown } | null;
  return {
    rule: null,
    failure: {
      code: typeof p?.code === "string" ? p.code : null,
      capability: typeof p?.capability === "string" ? p.capability : null,
      status,
    },
  };
}
