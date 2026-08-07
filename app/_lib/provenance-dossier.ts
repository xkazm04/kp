import type { AnalysisResult } from "./schemas.generated";
import { splitSanityChecks } from "./sanity-checks";

// Evidence-linked explainable verdict (idea-0832ec48). The analysis already
// carries everything an auditable decision needs — per-component scores, the
// per-dimension evidenceTrace quotes that justify them, the jobFit risk flags,
// the soft-signal hypotheses, and the sanity-check trust ledger — but it lived
// only inside the on-screen tabs. This assembles it into ONE exportable
// provenance dossier (Markdown): every score component is shown beside the CV
// evidence that produced it, so a recruiter can hand a hiring panel (or a
// compliance review under the EU AI Act) a record of WHY the number is what it is.
//
// Pure + dependency-light (only the sanity-check classifier) so it's unit-testable
// and degrades gracefully on any missing field — a partial/older payload still
// produces a coherent dossier rather than throwing.
//
// WHOSE LANGUAGE: CANONICAL ENGLISH, BY DECISION (F15). This is the one downloadable
// artifact kp does NOT localize, and the reasons are structural rather than a
// backlog item — see docs/architecture/localization.md, "Where English is allowed to
// exist" and the sealed-record rule.
//
//  1. It is a SEALED RECORD, not a screen. The repo already rules that "a sealed or
//     persisted field keeps its canonical English, and the UI renders the localized
//     mirror" — `approvedBy` and the screening `rationale` in the decision chain,
//     `codeReview.summary` in a pipeline entry's evidence record. A dossier is that
//     rule's export format: it exists so a reviewer can be shown WHAT WAS RECORDED.
//  2. There is no language to pin it to. `AnalysisResult` carries no `lang` field
//     (unlike a comms entry, a JD build or an interview-prep payload), so the only
//     candidate is the request locale — which would make the SAME analysis export
//     differently on Tuesday than on Monday because someone flipped the appearance
//     menu. An auditable record has to be reproducible; a request-scoped one is not.
//  3. Localizing the ~20 headings would produce a document that is no language at
//     all. Everything under those headings — the evidence quotes lifted from the CV,
//     `explanation`, `jobFit.summary`, the soft-signal `label`/`detail`, the
//     sanity-check texts — is frozen payload from the run that produced it and cannot
//     be translated at export time. Czech headings over English evidence is a worse
//     artifact than an English one, and it hides which parts are the record.
//
// The recruiter-facing MIRROR of all of this is localized: the results panels render
// the same numbers and evidence through `useTranslations()`. What leaves the app as a
// record leaves in one stable language, which is exactly the split the decision chain
// already draws.
//
// If this is ever revisited, the honest fix is upstream: stamp a `lang` on the
// analysis at run time (the way `jd-build-run` does) so the dossier has a document
// language to be pinned to — then it becomes a document-reader surface like the rest.

function bullets(items: readonly string[] | null | undefined, empty = "—"): string {
  const list = (items ?? []).map((s) => String(s).trim()).filter(Boolean);
  return list.length ? list.map((s) => `- ${s}`).join("\n") : `_${empty}_`;
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}\n`;
}

/** Build the Markdown provenance dossier for one analysis. `meta.candidateLabel`
 *  overrides the name when the payload's candidate.name is blank (the History row
 *  carries the recruiter-facing label); `meta.savedAt` stamps when it was run. */
export function buildProvenanceDossier(
  analysis: AnalysisResult,
  meta?: { candidateLabel?: string | null; savedAt?: string | null }
): string {
  const name = (analysis.candidate?.name || meta?.candidateLabel || "Candidate").trim();
  const cand = analysis.candidate;
  const score = analysis.score;
  const ev = analysis.evidenceTrace;
  const jobFit = analysis.jobFit;
  const soft = analysis.softSignals;

  const out: string[] = [];
  out.push(`# Provenance dossier — ${name}`);
  const headerBits = [
    cand?.roleFamily,
    cand?.currentSeniority,
    cand?.yearsExperience != null ? `${cand.yearsExperience}y experience` : null,
    meta?.savedAt ? `analysed ${meta.savedAt}` : null,
  ].filter(Boolean);
  if (headerBits.length) out.push(`_${headerBits.join(" · ")}_`);
  out.push("");

  // Overall
  const overall: string[] = [`**Total score: ${score?.total ?? "—"}/100**`];
  if (analysis.explanation?.trim()) overall.push(analysis.explanation.trim());
  if (jobFit) overall.push(`**Job fit: ${jobFit.score}/100** — ${jobFit.summary}`);
  out.push(section("Overall assessment", overall.join("\n\n")));

  // Score components, each beside its evidence (the heart of the dossier).
  const comp = (label: string, value: number | undefined, quotes: readonly string[] | null | undefined): string =>
    `### ${label} — ${value ?? "—"}/100\n\n${bullets(quotes, "No CV evidence captured for this dimension.")}`;
  out.push(
    section(
      "Score components & supporting CV evidence",
      [
        comp("Experience", score?.experience, ev?.experience),
        comp("Skills", score?.skills, ev?.skills),
        comp("Seniority", score?.roleSeniority, ev?.seniority),
        comp("Education", score?.education, ev?.education),
        // Traits has no dimension in evidenceTrace; show the score alone.
        `### Traits — ${score?.traits ?? "—"}/100`,
      ].join("\n\n")
    )
  );

  // Job fit risk flags + what must be proven (the recruiter-facing caveats).
  if (jobFit) {
    const jf: string[] = [];
    if (jobFit.matchingSkills?.length) jf.push(`**Matching skills:** ${jobFit.matchingSkills.join(", ")}`);
    if (jobFit.missingSkills?.length) jf.push(`**Missing skills:** ${jobFit.missingSkills.join(", ")}`);
    if (jobFit.recruiterRiskFlags?.length) jf.push(`**Risk flags:**\n${bullets(jobFit.recruiterRiskFlags)}`);
    if (jobFit.mustProveEvidence?.length) jf.push(`**Must prove in interview:**\n${bullets(jobFit.mustProveEvidence)}`);
    if (jf.length) out.push(section("Job fit", jf.join("\n\n")));
  }

  // Soft-signal hypotheses, with their evidence + confidence (always human-confirmed).
  if (soft && (soft.strengths?.length || soft.antipatterns?.length)) {
    const fmt = (s: { label: string; detail: string; confidence: number; source: string; evidence: readonly string[] }) =>
      `- **${s.label}** (confidence ${Math.round((s.confidence ?? 0) * 100)}%, ${s.source}) — ${s.detail}${
        s.evidence?.length ? `\n  - evidence: ${s.evidence.join("; ")}` : ""
      }`;
    const parts: string[] = [];
    if (soft.strengths?.length) parts.push(`**Strengths**\n${soft.strengths.map(fmt).join("\n")}`);
    if (soft.antipatterns?.length) parts.push(`**Watch-outs**\n${soft.antipatterns.map(fmt).join("\n")}`);
    out.push(section("Soft signals (hypotheses — confirm in interview)", parts.join("\n\n")));
  }

  // The trust ledger: which automated sanity checks warned vs passed.
  const { warns, oks } = splitSanityChecks(analysis.sanityChecks ?? []);
  out.push(
    section(
      "Trust ledger (automated sanity checks)",
      `**Warnings (${warns.length})**\n${bullets(warns, "None")}\n\n**Passed (${oks.length})**\n${bullets(oks, "None")}`
    )
  );

  out.push("---");
  out.push(
    "_Each score component above is shown beside the CV evidence that produced it. This report is advisory; a human makes the hiring decision._"
  );
  return out.join("\n");
}
