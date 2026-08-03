"use client";

// Process trace (DECISIONS log + commit cadence) and seed-engagement strips,
// split out of DevEvalPanel.tsx.
//
// Two submission paths reach this component and they do NOT carry the same
// telemetry. The repo path reconstructs from a git log (commits, cadence, changed
// paths). The Live Work Surface has no git by design — it has a watched event
// stream instead. Rendering only the git-shaped fields meant the best submissions
// displayed the least evidence, and an empty strip reads as "nothing happened".
// So each path renders the cadence evidence it actually has, and each says plainly
// where the other path's metric does not exist for it.
import { useTranslations } from "next-intl";
import type { EvalBundle } from "./DevTypes";

export function DevEvalPanelProcessTrace({ ev }: { ev: EvalBundle }) {
  const t = useTranslations("devcase.processTrace");
  // `tooling.signals` is emitted only by the observed path (process_events.
  // tooling_from_events), so its presence IS the "this was watched" tell — the same
  // thing perStepSources.tooling === "observed" reports, read straight off the data
  // the strip needs anyway.
  const sig = ev.tooling?.signals ?? null;

  return (
    <>
      {/* process trace (DEVP6) — persisted "so the decisions-log contract is checkable
          later instead of taken on faith"; this strip is where it finally is. Keeping
          the DECISIONS log is a mandated task of the case (coral when skipped); cadence
          is a how-they-worked signal, deliberately framed neutrally, not as a verdict. */}
      {ev.processTrace ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              ev.processTrace.decisionsLogPresent ? "bg-moss/10 text-moss" : "bg-coral/15 text-coral"
            }`}
          >
            DECISIONS log: {ev.processTrace.decisionsLogPresent ? "kept" : "missing"}
          </span>
          {ev.processTrace.cadence?.spanHours != null ? (
            <span className="text-steel">
              {ev.processTrace.commitCount ?? ev.commitCount ?? 0} commits over{" "}
              {Math.round(ev.processTrace.cadence.spanHours * 10) / 10} h
            </span>
          ) : null}
          {ev.processTrace.cadence?.bursty === true ? (
            <span className="rounded bg-paper px-1.5 py-0.5 text-steel" title="Commits landed in one tight burst — how they worked, not a verdict">
              single sitting
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Observed cadence — the live-session counterpart to the commit strip above.
          `iterationPattern` and the two post-perturbation counters were derived by
          process_events.derive_signals for every session and then dropped on the floor
          (they were never declared on `Tooling`), so a live session rendered no cadence
          evidence at all. Neutral framing, exactly like the commit cadence: this is how
          they worked, not a verdict. */}
      {sig ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
          {sig.iterationPattern ? (
            <span className="rounded bg-paper px-1.5 py-0.5 font-semibold uppercase text-steel" title={t("iterationTitle")}>
              {sig.iterationPattern === "iterative" ? t("iterative") : t("singlePass")}
            </span>
          ) : null}
          <span className="text-steel">
            {t("filesWorked", { opened: sig.filesOpened ?? 0, edited: sig.filesEdited ?? 0 })}
          </span>
          {/* No commit history is a PROPERTY of this path, not a finding about the
              candidate. Say so, rather than leaving a gap where the commit strip sits
              for the other path. */}
          <span className="text-steel" title={t("noCommitsTitle")}>
            · {t("noCommits")}
          </span>
        </div>
      ) : null}

      {/* Mid-flight perturbation (LLM-era control #5) — the one control with an
          end-to-end path to a human before this change, so it is rendered explicitly
          rather than left implicit in the counters. `perturbationShown: false` means
          the reveal never fired for this session: no signal, NOT "failed to adapt". */}
      {sig?.perturbationShown ? (
        <div className="mt-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              (sig.editsAfterPerturbation ?? 0) > 0 ? "bg-moss/10 text-moss" : "bg-amber-100 text-amber-700"
            }`}
            title={t("perturbationTitle")}
          >
            {(sig.editsAfterPerturbation ?? 0) > 0
              ? t("perturbationAdapted", {
                  edits: sig.editsAfterPerturbation ?? 0,
                  decisions: sig.decisionsAfterPerturbation ?? 0,
                })
              : t("perturbationStale")}
          </span>
        </div>
      ) : null}

      {/* c364a44d — seed engagement: which planted seam files the submission
          actually touched. Grounded, mechanically-comparable evidence (every
          candidate starts from the same seed) beside the LLM's probe read — an
          untouched seam file is a seam they never opened.
          Both paths reach this now: the repo path via the commits API's changed
          paths, the live path via a content diff of the submitted tree (see
          devcase-seed-diff.changedPathsFromFiles). */}
      {ev.seedDiff && ev.seedDiff.total > 0 ? (
        <div className="mt-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              ev.seedDiff.touched === 0 ? "bg-coral/15 text-coral" : "bg-paper text-steel"
            }`}
            title="Files from the shared starter seed the submission modified — the seed plants each probe's seam, so an untouched file is a seam they never engaged."
          >
            Seed engagement: {ev.seedDiff.touched}/{ev.seedDiff.total} planted files touched
          </span>
          {ev.seedDiff.untouched.length > 0 ? (
            <span className="ml-1.5 text-steel">untouched: {ev.seedDiff.untouched.join(", ")}</span>
          ) : null}
        </div>
      ) : sig ? (
        // A live session with no seed diff means the case never materialized a seed
        // (a deterministic/prose-only skeleton). Absence of the answer key, not
        // absence of engagement — say which.
        <p className="mt-1.5 text-micro text-steel">{t("noSeed")}</p>
      ) : null}
    </>
  );
}
