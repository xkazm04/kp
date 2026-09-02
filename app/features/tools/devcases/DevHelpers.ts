import { timeboxHoursForDisplay } from "@/app/_lib/devcase-timebox";
import { isNotAssessedRating, type Scorecard } from "@/app/_lib/interview-scorecard";
import type { CaseScenario, PerStepSources, RoleSpec, SourceDescriptor, SourceKind } from "./DevTypes";

// Single source of truth for how each provenance state reads and looks, so the
// label, chip colour and degraded warning are decided in one place and always
// agree. A run is "partial" (isDegraded) when some pipeline steps used the LLM
// and others fell back to deterministic templates — surfaced instead of
// mislabelling it a full LLM run. Visual language: moss = real LLM, amber =
// degraded/mixed, muted stone = template/deterministic.
//
// The three words themselves used to live here as English prose, and they surfaced
// as chip labels, `title` tooltips and the strip's whole aria-label — the one part
// of a provenance chip a screen-reader user gets. A plain module has no translator
// in scope, so the descriptor names its string (`labelKey`) and the component that
// renders it resolves the key.
const SOURCE_DESCRIPTORS: Record<SourceKind, SourceDescriptor> = {
  llm: { labelKey: "llm", dotClass: "bg-moss", textClass: "text-ink", isDegraded: false },
  partial: { labelKey: "partial", dotClass: "bg-amber-400", textClass: "text-amber-700", isDegraded: true },
  deterministic: { labelKey: "deterministic", dotClass: "bg-stone-300", textClass: "text-steel", isDegraded: false },
};

// The pipeline steps the CLI provenance envelope can name. A DECLARED set, so the
// catalogs can be asserted against it in both directions rather than trusting that
// whoever added a step remembered the four locales.
export const PIPELINE_STEPS = ["analyze", "source", "role", "case", "reflect", "tooling", "evaluate", "transfer"] as const;

/** A step key -> its label, given a lookup that answers null for "no such string".
 *
 *  Pure and lookup-injected precisely so the FALLBACK is testable: an envelope from a
 *  newer engine can carry a step this build has never heard of, and a capitalised raw
 *  id is a better degradation than a hole in the strip or a thrown render. The lookup
 *  half is the catalog; this half is what happens when the catalog has no answer. */
export function stepLabel(key: string, lookup: (k: string) => string | null): string {
  const known = lookup(key);
  if (known) return known;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
}

// Unknown / legacy / absent values degrade to the deterministic descriptor — the
// runtime lookup catches strings outside the union (e.g. a future "cached") that
// the type checker can't see in data parsed from JSON.
export function describeSource(source?: SourceKind | null): SourceDescriptor {
  return (source && SOURCE_DESCRIPTORS[source]) ?? SOURCE_DESCRIPTORS.deterministic;
}

// WHICH provenance produced the evaluation's strengths/concerns — the `evaluate`
// step alone, never the whole run. The combined `source` is "partial" for ANY mix
// (provenance.py: all-llm -> "llm", all-template -> "deterministic", mixed ->
// "partial"), so reading it to explain an empty finding set told the recruiter
// "re-run with the LLM for a richer read" about a read the LLM had already
// produced — a claim about provenance the same bundle contradicts one chip to the
// left, on the strip that exists to be honest about exactly this. Bundles saved
// before the per-step envelope carry no map and fall back to the run source.
export function findingsSource(bundle: {
  source?: SourceKind | null;
  perStepSources?: PerStepSources | null;
}): SourceKind | null {
  return bundle.perStepSources?.evaluate ?? bundle.source ?? null;
}

// The approve gate refuses a case whose probes can't discriminate with
// 422 { code: "probe_audit_failed" } (devcase-probe-audit.enforceProbeGate). The
// `errors` catalog carries no entry for that code, so the shared code-resolver fell
// through to the caller's generic fallback and the reviewer was told only "Approve
// failed." — the refusal is specific, actionable and already stated in the reader's
// language by the probe-strength banner in the very same drawer. Pick the fallback
// from the code so the one refusal the gate can raise names itself.
export const PROBE_GATE_CODE = "probe_audit_failed";
export function approveFallbackFor(
  code: string | null | undefined,
  strings: { probeGate: string; generic: string }
): string {
  return code === PROBE_GATE_CODE ? strings.probeGate : strings.generic;
}

// The grounded repo analysis only supports GitHub (github.com URL or bare
// owner/repo). Any other host can't be fetched, so the case runs ungrounded at
// low confidence — we warn the user rather than silently wrapping it as github.
export function isSupportedRepoRef(raw: string): boolean {
  const ref = raw.trim();
  if (!ref) return true; // empty = no codebase, that's fine
  if (/github\.com/i.test(ref)) return true;
  if (/^[^/\s]+\/[^/\s]+$/.test(ref)) return true; // bare owner/repo
  return false;
}

// One markdown-list item must stay on one line for the renderer, but case tasks /
// briefs may carry stray newlines from the LLM — collapse them inside an item.
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

// The CANDIDATE-FACING assignment document, composed as Markdown for the case
// detail reader (rendered by app/_components/Markdown). Internal material — cover
// probes, decision spaces, rubric weights, role spec — is deliberately NOT part of
// this document, so copy-pasting it to a candidate can never leak a probe; the
// detail view renders those in clearly-marked internal panels instead.
export function caseToMarkdown(kase: CaseScenario, role?: RoleSpec | null): string {
  const lines: string[] = [`# ${oneLine(kase.title || "Assignment")}`];
  const meta = [
    role?.title,
    role?.seniority,
    // The CLAMPED number, not the stored one. This document is the artifact that
    // travels to the candidate, and it was the last reader of `timeboxHours` that
    // still printed it raw — so a reviewer who typed 6 saw "~2h" on the design card
    // and handed out "~6h timebox" one step later. app/_lib/devcase-timebox.ts is
    // the single producer of the number any human is shown.
    `~${timeboxHoursForDisplay(kase.timeboxHours)}h timebox`,
  ].filter(Boolean);
  if (meta.length) lines.push("", `**${meta.join(" · ")}**`);
  if (kase.brief?.trim()) lines.push("", "## Brief", kase.brief.trim());
  if (kase.repoSeed?.trim()) lines.push("", "## What you're handed", kase.repoSeed.trim());
  const tasks = (kase.tasks ?? []).map(oneLine).filter(Boolean);
  if (tasks.length) {
    lines.push("", "## Tasks");
    tasks.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }
  return lines.join("\n");
}

// --- What the review drawer would actually SEND, decided once and testable -----
//
// This was a four-branch `if` inside DevLifecycleReviewPanel's render, and the
// tasks branch was guarded with `editedTasks.length > 0` — so emptying the task
// textarea produced no `tasks` key at all. The reviewer watched every task leave
// the candidate-safe preview, pressed Approve, and the assignment shipped with the
// tasks still on it: the one edit that looked most deliberate was the one silently
// discarded. An assignment with no tasks is not something we hand a candidate
// either, so the clear is REFUSED and named on screen rather than sent. Pure, so
// the rule is asserted (DevHelpers.test.ts) instead of read off a JSX expression.

export type CaseDraft = {
  title: string;
  brief: string;
  /** Already split + trimmed + emptied-lines-dropped by the panel's textarea. */
  tasks: string[];
  /** Already CLAMPED by the shared timebox policy, or null when the field is blank. */
  timeboxHours: number | null;
};

/** Why an otherwise-valid draft cannot be submitted. One member today; a union so a
 *  second refusal lands as a new label rather than a boolean nobody can name. */
export type CaseEditBlock = "tasksCleared";

export function caseEdits(kase: CaseScenario, draft: CaseDraft): {
  edits: Record<string, unknown>;
  blocked: CaseEditBlock | null;
} {
  const edits: Record<string, unknown> = {};
  const title = draft.title.trim();
  const brief = draft.brief.trim();
  // A blanked field is "leave it alone", not "set it empty" — the same rule the
  // live preview applies, so preview and payload cannot disagree.
  if (title && title !== (kase.title ?? "")) edits.title = title;
  if (brief && brief !== (kase.brief ?? "")) edits.brief = brief;
  const storedTasks = kase.tasks ?? [];
  let blocked: CaseEditBlock | null = null;
  if (draft.tasks.join("\n") !== storedTasks.join("\n")) {
    if (draft.tasks.length === 0) blocked = "tasksCleared";
    else edits.tasks = draft.tasks;
  }
  if (draft.timeboxHours != null && draft.timeboxHours !== kase.timeboxHours) {
    edits.timeboxHours = draft.timeboxHours;
  }
  return { edits, blocked };
}

/** The mean of the ratings that were actually OBSERVED, for the voice-screen panel.
 *
 *  `isNotAssessedRating` is the read-side guard the rest of the app already applies:
 *  the AI synthesis rates an untouched competency 3/5 with "Not assessed…" evidence, so
 *  averaging raw ratings drags every partial interview toward a middling 3 that looks
 *  like a judgement and is not one. Null when nothing was assessed.
 *
 *  It lives here, not in the panel, because a number a reviewer reads as a verdict is
 *  worth a test and a "use client" .tsx cannot carry one under this runner. */
export function observedMean(scorecard: Scorecard | null): number | null {
  const rated = (scorecard?.ratings ?? []).filter(
    (r) => typeof r.rating === "number" && !isNotAssessedRating(r.rating, r.evidence)
  );
  if (rated.length === 0) return null;
  return rated.reduce((sum, r) => sum + r.rating, 0) / rated.length;
}
