// Pure model for the Agent fit tab — no React, no next-intl, so the reducers
// unit-test under `node --test` (npm run test:unit). The hook lives in
// jobsAgentFitLogic.ts and the views in JobsAgentFit*.tsx.
import type { AgentStatus } from "@/app/_lib/db/agents";

// ---- Fit verdict ------------------------------------------------------------

export type FitVerdict = "complete" | "temporary" | "unassessed";

export function toFitVerdict(value: unknown): FitVerdict {
  return value === "complete" || value === "temporary" ? value : "unassessed";
}

// The eval-report verdict convention (VerdictBanner.tsx / runner.py's
// verdict_banner): a colored left bar + the shared ✓ / ✗ / – glyph set on the
// theme-mapped score-* scale. complete rides strong, temporary the mid band, and
// unassessed the honest null tone — never a fabricated verdict on absent data.
export const VERDICT_SKIN: Record<FitVerdict, { glyph: string; bar: string; text: string; key: string }> = {
  complete: { glyph: "✓", bar: "border-l-score-strong", text: "text-score-strong", key: "complete" },
  temporary: { glyph: "–", bar: "border-l-score-mid", text: "text-score-mid", key: "temporary" },
  unassessed: { glyph: "–", bar: "border-l-score-null", text: "text-score-null", key: "unassessed" },
};

export type CoverageClass = "automatable" | "assisted" | "human_only";
export type CoverageItem = { item: string; coverage: string; rationale: string };

// Per-responsibility glyphs on the same score scale: automatable ✓, assisted △
// (partial — the agent drafts, a human finishes), human_only ✗.
export const COVERAGE_SKIN: Record<CoverageClass, { glyph: string; text: string; key: string }> = {
  automatable: { glyph: "✓", text: "text-score-strong", key: "automatable" },
  assisted: { glyph: "△", text: "text-score-mid", key: "assisted" },
  human_only: { glyph: "✗", text: "text-score-weak", key: "humanOnly" },
};

export function coverageSkin(coverage: string): { glyph: string; text: string; key: string } {
  return COVERAGE_SKIN[coverage as CoverageClass] ?? { glyph: "–", text: "text-score-null", key: "unknown" };
}

/** The stored fit blob, defensively narrowed (it crosses a JSON boundary). */
export function fitOf(raw: unknown): { verdict: FitVerdict; coverage: CoverageItem[]; coverageRatio: number | null } {
  const f = (raw ?? {}) as { verdict?: unknown; coverage?: unknown; coverageRatio?: unknown };
  const coverage = Array.isArray(f.coverage)
    ? f.coverage
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          item: typeof c.item === "string" ? c.item : "",
          coverage: typeof c.coverage === "string" ? c.coverage : "",
          rationale: typeof c.rationale === "string" ? c.rationale : "",
        }))
        .filter((c) => c.item)
    : [];
  return {
    verdict: toFitVerdict(f.verdict),
    coverage,
    coverageRatio: typeof f.coverageRatio === "number" && Number.isFinite(f.coverageRatio) ? f.coverageRatio : null,
  };
}

/** Anything but the explicit "llm" source is the keyword-heuristic fallback —
 *  same doctrine as isPrepFallback: an unknown source never passes as AI. */
export function isFallbackSource(source: string | null | undefined): boolean {
  return (source ?? "").trim().toLowerCase() !== "llm";
}

// ---- Editable spec form -----------------------------------------------------

export type FitMetric = { key: string; label: string; target: number; unit: string; direction: string };

export type SpecForm = {
  name: string;
  mission: string;
  connectors: string[];
  /** Raw text of the budget input — parsed by budgetFromInput on dispatch. */
  budget: string;
};

/** Initialize the editable form from a stored agent_fit_specs record — null-safe
 *  against a partial/fallback spec and a band-less (null) budget suggestion. */
export function specFormFromRecord(record: { spec: unknown; budget: unknown }): SpecForm {
  const spec = (record.spec ?? {}) as { name?: unknown; mission?: unknown; connectors?: unknown };
  const budget = (record.budget ?? {}) as { suggestedMonthlyUsd?: unknown };
  return {
    name: typeof spec.name === "string" ? spec.name : "",
    mission: typeof spec.mission === "string" ? spec.mission : "",
    connectors: Array.isArray(spec.connectors)
      ? spec.connectors.filter((c): c is string => typeof c === "string" && !!c.trim())
      : [],
    budget:
      typeof budget.suggestedMonthlyUsd === "number" && Number.isFinite(budget.suggestedMonthlyUsd)
        ? String(budget.suggestedMonthlyUsd)
        : "",
  };
}

/** Toggle a connector chip: present → removed, absent → appended (re-add from
 *  the catalog). Order-preserving so the chips don't jump around. */
export function toggleConnector(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((c) => c !== name) : [...list, name];
}

/** Budget input → USD number: "" = null (no cap), invalid/negative = invalid. */
export function budgetFromInput(text: string): { value: number | null; invalid: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, invalid: false };
  // A single comma is the cs/de/fr DECIMAL separator, so "99,5" is 99.5 — but a
  // GROUP separator wears the same character. "2,000" fell through this function as
  // Number("2.000") = 2 with invalid:false, so an operator capping an agent at
  // $2,000/month dispatched it with a $2 cap and never saw a validation error. Which
  // one "2,000" means is genuinely undecidable across the four locales this app ships
  // (1500 in en, 1.5 in cs), so a grouped-LOOKING value — 1-3 digits, one separator,
  // exactly 3 digits — is reported invalid and retyped rather than guessed. Values
  // that cannot be read as grouping ("1234.56") and the decimal comma are untouched;
  // two separators ("1,234.56") already fell out as NaN below.
  if (/^\d{1,3}[.,]\d{3}$/.test(trimmed)) return { value: null, invalid: true };
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return { value: null, invalid: true };
  return { value: Math.round(n * 100) / 100, invalid: false };
}

/** The dispatch overrides payload — exactly the fields the operator can edit and
 *  POST /api/agents/dispatch honors (name, mission, connectors, budgetUsd).
 *  Metrics are read-only here: the dispatch route always reads them from the
 *  stored spec, so offering an edit the server drops would be a lie. */
export function buildOverrides(form: SpecForm): Record<string, unknown> {
  const { value } = budgetFromInput(form.budget);
  return {
    name: form.name.trim(),
    mission: form.mission.trim(),
    connectors: form.connectors,
    ...(value !== null ? { budgetUsd: value } : {}),
  };
}

// ---- Status timeline --------------------------------------------------------

/** Client-side mirror of ACTIVE_AGENT_STATUSES (db/agents.ts) — that module is
 *  sqlite-backed, so the runtime const can't cross into the browser bundle. */
export const LIVE_AGENT_STATUSES: readonly AgentStatus[] = ["dispatched", "pending_approval", "onboarding", "active"];

export const TIMELINE_STEPS = ["dispatched", "pending_approval", "onboarding", "active"] as const;
export type TimelineStepKey = (typeof TIMELINE_STEPS)[number];
export type TimelineStep = { key: TimelineStepKey; state: "done" | "current" | "upcoming" };

// How far up the ladder each terminal status got before ending: a failed
// dispatch never left step 0, a rejection happened at the approval gate, and a
// retired agent had been fully active.
const TERMINAL_REACHED: Record<string, number> = { failed: 0, rejected: 1, retired: 3 };

/** The dispatched → pending approval → onboarding → active ladder, with
 *  rejected/failed/retired as terminal markers outside the ladder. */
export function timeline(status: AgentStatus): { steps: TimelineStep[]; terminal: AgentStatus | null } {
  const idx = (TIMELINE_STEPS as readonly string[]).indexOf(status);
  const terminal = idx === -1 ? status : null;
  const reached = terminal ? (TERMINAL_REACHED[terminal] ?? -1) : idx;
  return {
    steps: TIMELINE_STEPS.map((key, i) => ({
      key,
      state: terminal ? (i <= reached ? "done" : "upcoming") : i < reached ? "done" : i === reached ? "current" : "upcoming",
    })),
    terminal,
  };
}
