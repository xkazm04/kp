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
