import type { CaseScenario, RoleSpec, SourceDescriptor, SourceKind } from "./DevTypes";

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
    kase.timeboxHours ? `~${kase.timeboxHours}h timebox` : null,
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
