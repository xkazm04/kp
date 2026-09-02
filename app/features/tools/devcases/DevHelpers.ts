import { timeboxHoursForDisplay } from "@/app/_lib/devcase-timebox";
import type { CaseScenario, PerStepSources, RoleSpec, SourceDescriptor, SourceKind } from "./DevTypes";

// Single source of truth for how each provenance state reads and looks, so the
// label, chip colour and degraded warning are decided in one place and always
// agree. A run is "partial" (isDegraded) when some pipeline steps used the LLM
// and others fell back to deterministic templates — surfaced instead of
// mislabelling it a full LLM run. Visual language: moss = real LLM, amber =
// degraded/mixed, muted stone = template/deterministic.
const SOURCE_DESCRIPTORS: Record<SourceKind, SourceDescriptor> = {
  llm: { label: "Claude CLI", dotClass: "bg-moss", textClass: "text-ink", isDegraded: false },
  partial: { label: "Partial (degraded)", dotClass: "bg-amber-400", textClass: "text-amber-700", isDegraded: true },
  deterministic: { label: "template", dotClass: "bg-stone-300", textClass: "text-steel", isDegraded: false },
};

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
