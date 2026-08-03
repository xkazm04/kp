"use client";

// LLM-era anti-delegation controls #2, #3 and #6, made visible.
//
// `observedChecks` is the block of MECHANICAL verdicts the Python side computes
// against known ground truth (devcase_cli `extras`): planted-canary outcomes, the
// distance from the frozen one-shot AI baseline, and deterministic signals over the
// captured assistant/stakeholder transcript. It was persisted with every bundle and
// read only by an LLM prompt. This panel is where a human finally sees it.
//
// Three product rules are load-bearing here, not decoration:
//
//  1. HONEST DARKNESS. Every check is optional at the producer: `{}` for a repo
//     submission, no `canaryOutcomes` when the case's seed planted none (the
//     deterministic seed refuses to fabricate ground truth — seed_materializer.py:
//     "a template flaw with no real ground truth would grade candidates against
//     noise"), no `baselineSimilarity` when the LLM was down at approval. Each of
//     those renders as "this check did not run", NEVER as a pass.
//
//  2. BASELINE SIMILARITY IS NOT A PENALTY. The engine says so explicitly. It is
//     rendered as a neutral figure with an interview prompt — no bar, no colour
//     ramp, nothing that reads as a score.
//
//  3. AI USE IS NEVER A PENALTY. Prompt counts are context that aims the
//     interview. `briefPasteRatio` is the one negative-leaning signal and it is
//     labelled as an interview aim, in blue, never in coral.
import { AlertTriangle, Check, CircleHelp, Flag, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatFraction } from "@/app/_lib/format";
import { CANARY_STATUSES, type CanaryOutcome, type CanaryStatus, type ObservedChecks } from "./DevTypes";

// The four-way canary vocabulary, presented as four DISTINCT states — collapsing
// them to pass/fail would erase the two that matter most: `propagated` (the planted
// flaw survived into the submission) and `unverifiable` (we cannot grade this, so
// we don't). Keyed off CANARY_STATUSES; the i18n catalogs are pinned to that same
// list by set equality in devcase-canary-catalog.test.ts.
const CANARY_TONE: Record<CanaryStatus, { cls: string; Icon: LucideIcon }> = {
  addressed: { cls: "bg-moss/15 text-moss", Icon: Check },
  flagged: { cls: "bg-blue-50 text-blue-700", Icon: Flag },
  propagated: { cls: "bg-coral/15 text-coral", Icon: AlertTriangle },
  unverifiable: { cls: "bg-stone-100 text-steel", Icon: CircleHelp },
};

// `status` arrives as a plain string from free-form Python JSON. Anything we do not
// recognise is treated as UNVERIFIABLE — the honest default, never a pass.
function canaryStatus(raw?: string): CanaryStatus {
  return (CANARY_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as CanaryStatus) : "unverifiable";
}

// A high similarity to the naive one-shot baseline is where the authorship
// interview should aim. Mirrors the engine's own threshold in
// artifact_checks.check_evidence.
const BASELINE_AIM_INTERVIEW = 0.85;
// Mirrors prompt_signals.prompt_evidence: at/above this share of the brief, one
// prompt carried the one-shot delegation shape.
const BRIEF_PASTE_AIM_INTERVIEW = 0.6;

function CanaryRow({ c }: { c: CanaryOutcome }) {
  const t = useTranslations("devcase.checks");
  const status = canaryStatus(c.status);
  const { cls, Icon } = CANARY_TONE[status];
  return (
    <li className="flex items-center gap-1.5 text-micro text-ink" title={c.note || undefined}>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-semibold uppercase ${cls}`}>
        <Icon size={11} aria-hidden /> {t(`canary.${status}`)}
      </span>
      {c.path ? <span className="truncate text-steel">{c.path}</span> : null}
    </li>
  );
}

export function DevEvalPanelChecks({ checks, live }: { checks: ObservedChecks; live: boolean }) {
  const t = useTranslations("devcase.checks");

  // A repo-link submission has no watched process, no submitted tree and no
  // captured transcript, so NONE of these checks can run. Say that once, plainly,
  // instead of three "not available" rows that read like three failures.
  if (!live) {
    return (
      <div className="mt-2 border-t border-stone-100 pt-2">
        <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-steel">{t("title")}</p>
        <p className="text-micro text-steel">{t("repoSubmission")}</p>
      </div>
    );
  }

  const canaries = checks.canaryOutcomes ?? [];
  const graded = canaries.filter((c) => canaryStatus(c.status) !== "unverifiable");
  const caught = graded.filter((c) => ["addressed", "flagged"].includes(canaryStatus(c.status))).length;
  const ungradable = canaries.length - graded.length;

  const baseline = checks.baselineSimilarity;
  const baselineAvailable = baseline?.available === true;
  const similarity = baseline?.bestSimilarity ?? 0;

  const psig = checks.promptSignals;
  const promptObserved = psig?.observed === true;
  const briefPaste = psig?.briefPasteRatio ?? 0;

  return (
    <div className="mt-2 border-t border-stone-100 pt-2">
      <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-steel">{t("title")}</p>

      {/* --- Control #3: planted canaries --------------------------------- */}
      <div className="mb-1.5">
        {canaries.length === 0 ? (
          // Honest darkness: the deterministic (keyless) seed plants no canaries on
          // purpose. "Not run" — never a clean sheet.
          <p className="text-micro text-steel">{t("canaryNotRun")}</p>
        ) : (
          <>
            <p className="text-micro text-ink">
              {graded.length > 0 ? t("canarySummary", { caught, graded: graded.length }) : t("canaryNoneGradable")}
              {ungradable > 0 ? <span className="text-steel"> · {t("canaryUngradable", { count: ungradable })}</span> : null}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {canaries.map((c, i) => (
                <CanaryRow key={c.id || i} c={c} />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* --- Control #6: distance from the frozen one-shot AI baseline -----
          Deliberately typographic, not a meter: this is CONTEXT for the
          interview and the engine is explicit that it is never a penalty. */}
      <div className="mb-1.5">
        {!baselineAvailable ? (
          <p className="text-micro text-steel">{t("baselineNotRun")}</p>
        ) : (
          <>
            <p className="text-micro text-ink">
              {t("baselineSimilarity", { pct: formatFraction(similarity, { label: "baselineSimilarity" }) })}
            </p>
            <p className="text-micro text-steel">
              {similarity >= BASELINE_AIM_INTERVIEW ? t("baselineAimInterview") : t("baselineNeverPenalty")}
            </p>
          </>
        )}
      </div>

      {/* --- Control #2: the captured prompt channel ----------------------- */}
      <div>
        {!promptObserved ? (
          <p className="text-micro text-steel">{t("promptsNotUsed")}</p>
        ) : (
          <>
            <p className="text-micro text-ink">
              {t("promptSummary", {
                assistant: psig?.assistantPrompts ?? 0,
                depth: psig?.iterationDepth ?? 0,
                stakeholder: psig?.stakeholderQuestions ?? 0,
              })}
              {psig?.verificationAsks ? <span> · {t("verificationAsks", { count: psig.verificationAsks })}</span> : null}
            </p>
            <p className="text-micro text-steel">
              {briefPaste >= BRIEF_PASTE_AIM_INTERVIEW
                ? t("briefPasteAimInterview", { pct: formatFraction(briefPaste, { label: "briefPasteRatio" }) })
                : t("promptsNeverPenalty")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
