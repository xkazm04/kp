// What a finished background task ACTUALLY produced, as translatable lines.
//
// The tasks dock used to render one kind properly (batch_screen's counts) and dump
// every other kind's result through a generic `Object.entries()` list: the raw DB /
// handler key in mono on the left, `String(value)` on the right. That printed
// `markdown  # Senior Backend Engineer…` (the whole generated JD, truncated
// mid-word), `cached true`, `narrativeLang en`, `source deterministic` — internal
// vocabulary, untranslated, in every locale, and unexplained to the recruiter who
// is the only person who ever opens that drawer.
//
// This module is the table that replaces it. Per kind, a PURE mapper picks the few
// facts worth a line and returns them as (label key, value) pairs the component
// translates; anything not named here is not shown. Two rules make it safe:
//
//   • Every mapper reads DEFENSIVELY. A field that is absent, of the wrong type or
//     from an older row simply produces no line — never a crash, and never a line
//     that claims something the result does not say.
//   • The generic fallback (`genericOutcomeLines`) is an ALLOWLIST of four shapes
//     every handler shares (source / applied / ok+total / cached). A raw key or a
//     blob can no longer reach the drawer by default.
//
// TABLE and NO_TABLE_SUMMARY are typed as a partition of TaskKind (task-kinds.ts):
// a kind neither mapped here nor listed in NO_TABLE_SUMMARY with a reason is a
// compile error — so a new task kind cannot ship with a nameless outcome.

import type { TaskKind } from "./task-kinds";
import { fanoutOutcome } from "./task-fanout";

/** The label vocabulary. A closed union, not a string: next-intl keys are TYPED,
 *  so `t(`outcome.field.${labelKey}`)` only compiles while every member has a
 *  catalogue entry — which is what stops a mapper from inventing a label that
 *  renders as a missing-key crash in one locale. */
export type OutcomeFieldKey =
  | "source"
  | "outcome"
  | "language"
  | "freshness"
  | "savedAs"
  | "drafted"
  | "codebases"
  | "stage"
  | "detail"
  | "candidates"
  | "lead"
  | "caseIncluded"
  | "followups"
  | "proposals"
  | "failures"
  | "sent"
  | "notContacted";

/** The closed VALUE vocabulary — the internal tokens a result carries that a
 *  recruiter must never be shown raw (`deterministic`, `held_for_review`). Same
 *  typing rule as the labels. Anything not in here is data, not vocabulary, and
 *  rides on `value` instead. */
export type OutcomeValueKey =
  | "llm"
  | "deterministic"
  | "heuristic"
  | "skipped"
  | "cached"
  | "fresh"
  | "yes"
  | "no"
  | (typeof APPLIED_VALUES)[number];

/** One rendered fact. `valueKey` names the closed vocabulary the UI translates
 *  (`tasks.outcome.value.*`); `value` is data the run produced (a count, a slug,
 *  a candidate's name) and is rendered as-is. */
export type OutcomeLine = {
  labelKey: OutcomeFieldKey;
  /** Literal value — used when `valueKey` is absent. */
  value?: string | number;
  valueKey?: OutcomeValueKey;
};

// ── defensive readers ──────────────────────────────────────────────────────
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arrLen(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null;
}

/** Provenance vocabulary shared by every CLI envelope in the app (`source`). A
 *  value outside it yields NO line rather than an untranslated token. */
const SOURCES = ["llm", "deterministic", "heuristic", "skipped"] as const;
function isSource(v: string): v is (typeof SOURCES)[number] {
  return (SOURCES as readonly string[]).includes(v);
}
function sourceLine(v: unknown): OutcomeLine[] {
  const s = str(v);
  return s && isSource(s) ? [{ labelKey: "source", valueKey: s }] : [];
}

/** `AutomationResult.applied` — the full vocabulary produced by automation-run.ts
 *  (screenStageOutcome's three, plus the per-task labels). Anything else is an
 *  older row or a value this build has no word for, and produces no line. */
export const APPLIED_VALUES = [
  "advanced",
  "held_for_review",
  "advisory",
  "auto_ratified",
  "drafted",
  "scorecard_ready",
  "offer_ready",
  "offer_sent",
  "sent",
  "already_sent",
  "suppressed_anonymized",
  "suppressed_consent_expired",
  "rematched",
  "already_rematched",
  "no_alternative",
  "skipped_hired",
  "skipped_stage_changed",
] as const;
function isApplied(v: string): v is (typeof APPLIED_VALUES)[number] {
  return (APPLIED_VALUES as readonly string[]).includes(v);
}
function appliedLine(v: unknown): OutcomeLine[] {
  const s = str(v);
  return s && isApplied(s) ? [{ labelKey: "outcome", valueKey: s }] : [];
}

function freshnessLine(cached: unknown): OutcomeLine[] {
  if (typeof cached !== "boolean") return [];
  return [{ labelKey: "freshness", valueKey: cached ? "cached" : "fresh" }];
}

// ── line builders ──────────────────────────────────────────────────────────
// Small and typed on purpose: an inline `...(x ? [{ labelKey: "lead", value: x }] : [])`
// loses its contextual type inside the conditional and widens `labelKey` to
// `string`, which would let a mapper invent a label with no catalogue entry.

/** A DATA line — a count, a slug, a name the run produced. Absent / empty data
 *  yields no line at all, which is how every mapper degrades on an older row. */
function fact(labelKey: OutcomeFieldKey, value: string | number | null | undefined): OutcomeLine[] {
  return value == null || value === "" ? [] : [{ labelKey, value }];
}

/** A VOCABULARY line — an internal token the UI translates. */
function choice(labelKey: OutcomeFieldKey, valueKey: OutcomeValueKey): OutcomeLine[] {
  return [{ labelKey, valueKey }];
}

// ── the per-kind table ─────────────────────────────────────────────────────
type Mapper = (result: Record<string, unknown>) => OutcomeLine[];

/** Did this run produce a work-sample case? `case` is `{}` when the build ran
 *  --role-only, so its emptiness is the honest answer. Absent ⇒ no claim. */
function caseLine(v: unknown): OutcomeLine[] {
  const kase = obj(v);
  return kase ? choice("caseIncluded", Object.keys(kase).length > 0 ? "yes" : "no") : [];
}

/** The kinds that get a table mapper: the whole vocabulary minus the excused ones.
 *  Together the two tables are a type-checked PARTITION of TaskKind — a kind missing
 *  from both, or present in both, is a compile error at the edit. */
type MappedKind = Exclude<TaskKind, keyof typeof NO_TABLE_SUMMARY>;

const TABLE: Record<MappedKind, Mapper> = {
  // { result, source, applied } — the drawer's one useful fact is WHAT the run did.
  automation: (r) => [...appliedLine(r.applied), ...sourceLine(r.source)],
  // The reasoning payload plus { cached, narrativeLang }. `narrativeLang` is the
  // language the text was actually produced in — the panel's honest "shown in
  // English" note is derived from it, so it belongs on the outcome too.
  reasoning: (r) => [...freshnessLine(r.cached), ...fact("language", str(r.narrativeLang))],
  // { ok, total, results } — what actually happened to each letter. A row whose items
  // carry `applied` (task-fanout.ts) says how many were SENT and how many were
  // deliberately not contacted (consent expired / anonymized): both return without
  // throwing, so the old `ok / total` counted a suppressed letter as drafted. An
  // older row without per-item outcomes keeps that line — it is all it can say.
  batch_outreach: (r) => {
    const ledger = fanoutOutcome("batch_outreach", null, r, "succeeded");
    const items = Array.isArray(r.results) ? r.results : [];
    if (ledger && items.some((i) => typeof obj(i)?.applied === "string")) {
      const { deliveredIds, suppressedIds, failedIds } = ledger;
      return [
        ...fact("sent", deliveredIds.length),
        ...(suppressedIds.length ? fact("notContacted", suppressedIds.length) : []),
        ...(failedIds.length ? fact("failures", failedIds.length) : []),
      ];
    }
    const ok = num(r.ok);
    const total = num(r.total);
    if (ok == null || total == null) return [];
    const failed = total - ok;
    return [...fact("drafted", `${ok} / ${total}`), ...(failed > 0 ? fact("failures", failed) : [])];
  },
  // The merged analysis plus { persistence, servedFromCache, partialFailures }.
  // `persistence` is the saved report row the deep link opens.
  analyze: (r) => {
    const failed = arrLen(r.partialFailures);
    return [
      ...fact("savedAs", str(obj(r.persistence)?.slug)),
      ...freshnessLine(r.servedFromCache),
      ...(failed ? fact("failures", failed) : []),
    ];
  },
  need_analysis: (r) => [...sourceLine(r.source), ...fact("codebases", arrLen(r.snapshots))],
  design_artifacts: (r) => [...sourceLine(r.source), ...caseLine(r.case)],
  // SubmissionEvaluation. The followups are what the live interview uses to verify
  // the candidate owns the decisions the artifact claims — the one count worth a line.
  evaluate_submission: (r) => fact("followups", arrLen(obj(r.followups)?.questions)),
  lifecycle: (r) => [...fact("stage", str(r.stage)), ...fact("detail", str(r.detail))],
  group_eval: (r) => [
    ...fact("candidates", arrLen(r.recommendedOrder)),
    ...fact("lead", str(obj(r.lead)?.label)),
    ...sourceLine(r.comparisonSource),
  ],
  // The generated JD body itself is deliberately NOT a line (it was the worst of
  // the old dump: a whole markdown document truncated mid-word). Whether the build
  // produced a work-sample case is the fact the drawer can carry; the
  // "held as a revision" chip is rendered separately by TasksOutcome.
  jd_build: (r) => caseLine(r.case),
  interview_prep: (r) => [...sourceLine(r.source), ...fact("language", str(r.lang))],
  agent_fit: (r) => sourceLine(r.source),
  // The kit itself is the durable artifact (a new interview_kits DRAFT the editor opens),
  // so the one fact worth a line here is which engine wrote it — a deterministic kit is a
  // template the recruiter must rewrite, and a keyless install deserves to be told.
  interview_kit: (r) => sourceLine(r.source),
  // The letter itself is never on the result (the tasks table outlives an erasure), so the
  // facts are which engine wrote the draft and the language it was written in.
  interview_letter: (r) => [...sourceLine(r.source), ...fact("language", str(r.lang))],
  repo_scan: (r) => sourceLine(r.source),
  campaign: (r) => sourceLine(obj(r.pack)?.source),
  profile_draft: (r) => sourceLine(r.source),
  companion_digest: (r) => [...fact("proposals", num(r.proposals)), ...sourceLine(r.source)],
};

/** Kinds deliberately WITHOUT a table mapper, each with the reason. TABLE is typed
 *  by what this leaves out, so "nobody got round to it" is not a state this file can
 *  be in — a kind is either mapped or explained. */
export const NO_TABLE_SUMMARY = {
  // The one kind that already had a real renderer (advanced / held / advisory / of
  // total, as a sentence with ICU plurals). It stays bespoke in TasksOutcome —
  // a five-row label/value list would be a downgrade of a sentence that reads well.
  batch_screen: "rendered by its own counts sentence in TasksOutcome",
  // The result is a ScanSummary (per-source outcomes + matched/deepDived counts): a
  // table the /me/scans page renders from the scheduler_runs row the task also writes,
  // not a label/value list — and the closed OutcomeFieldKey vocabulary has no key for it.
  jobseeker_scan: "rendered as the per-source scan table on /me/scans from the scheduler_runs row",
} as const satisfies Partial<Record<TaskKind, string>>;

/** The generic fallback: the four shapes EVERY handler envelope shares. Used only
 *  for a kind with no mapper (an older row whose kind this build has dropped), and
 *  deliberately an allowlist — a key not named here is not rendered at all. */
export function genericOutcomeLines(result: unknown): OutcomeLine[] {
  const r = obj(result);
  if (!r) return [];
  const ok = num(r.ok);
  const total = num(r.total);
  return [
    ...appliedLine(r.applied),
    ...sourceLine(r.source),
    ...(ok != null && total != null ? fact("drafted", `${ok} / ${total}`) : []),
    ...freshnessLine("cached" in r ? r.cached : r.servedFromCache),
  ];
}

/** The lines a finished task's outcome drawer should render. Pure. */
export function taskOutcomeSummary(kind: string, result: unknown): OutcomeLine[] {
  const r = obj(result);
  if (!r) return [];
  // Own-property lookup: a stored kind is any string, and `TABLE["constructor"]` is
  // Object's constructor, not a mapper.
  const mapper = Object.hasOwn(TABLE, kind) ? TABLE[kind as MappedKind] : undefined;
  return mapper ? mapper(r) : genericOutcomeLines(r);
}

/** Kinds this module maps — exported for the exhaustiveness test. */
export const SUMMARIZED_KINDS: readonly string[] = Object.keys(TABLE);

// ── the deep link ──────────────────────────────────────────────────────────
// Moved off TasksOutcome.tsx unchanged: a .tsx cannot be loaded by the node test
// runner, so this router-ish derivation — every branch of which encodes a real
// product route — had no test at all.

export type OutcomeLinkKey =
  | "openSavedReport"
  | "openJdLibrary"
  | "openRoleDecisions"
  | "openDecisions"
  | "reviewInDecisions"
  | "openSchedule"
  | "openBoard";

export function taskOutcomeLink(task: {
  id: string;
  kind: string;
  params: unknown;
  result: unknown;
}): { href: string; key: OutcomeLinkKey } | null {
  const params = obj(task.params) ?? {};
  const result = obj(task.result) ?? {};
  if (task.kind === "analyze") {
    const slug = str(obj(result.persistence)?.slug);
    return slug ? { href: `/history/${encodeURIComponent(slug)}`, key: "openSavedReport" } : null;
  }
  // The task id rides along (?jdTask=) so JdBuilder can rehydrate this build's
  // generated JD — a bare tab switch landed on an empty builder, because it had
  // unmounted the component that held the result. The builder now lives on the
  // Job-intake tab (?tab=intake), and a `jd*` param is also what makes that tab
  // open on Generate rather than the intake dialog (jdsIntakeTabEntry.ts).
  if (task.kind === "jd_build") {
    return { href: `/?tab=intake&jdTask=${encodeURIComponent(task.id)}`, key: "openJdLibrary" };
  }
  // Decision-shaped runs land their output in the Decisions queue: a group eval
  // saves per-role (the ?job= filter isolates it), a batch screen raises
  // holds/reviews there.
  if (task.kind === "group_eval") {
    const jobId = str(params.jobId) ?? str(params.roleKey);
    return jobId
      ? { href: `/?tab=decisions&job=${encodeURIComponent(jobId)}`, key: "openRoleDecisions" }
      : { href: "/?tab=decisions", key: "openDecisions" };
  }
  if (task.kind === "batch_screen") return { href: "/?tab=decisions", key: "reviewInDecisions" };
  // Prep artifacts are opened from the Schedule tab's candidate cards.
  if (task.kind === "interview_prep") return { href: "/?tab=schedule", key: "openSchedule" };
  // Entry-scoped kinds carry a label; the board's ?q= filter isolates the
  // candidate (no per-entry deep link exists).
  const entryLabel = str(params.entryLabel) ?? str(params.candidateLabel);
  if (entryLabel) return { href: `/?tab=pipeline&q=${encodeURIComponent(entryLabel)}`, key: "openBoard" };
  return null;
}
