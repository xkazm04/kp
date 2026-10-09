"use client";

// Act 2's right-hand sheet: what the run will read (the company context, read-only), what it
// will do (CVs analysed fresh vs reused — units only where the install is KNOWN to meter), how
// (blind, report language — the same controls the v1 form offers), and Start. Below the
// head-to-head floor the run is not offered and the sheet says why. In the walkthrough, Start hands
// the request to the simulated run (useWalkthroughSource): no POST, no billing or engine read.
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { Checkbox } from "@/app/_components/Checkbox";
import { Select } from "@/app/_components/Select";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useEngineAvailabilityRead } from "@/app/features/shell/useEngineAvailability";
import { BTN_PRIMARY, META_LABEL, NOTICE, PANEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { isLocale, LOCALES } from "@/i18n/locales";
import { COHORT_MIN, type CohortProposal, type CohortRunRequest } from "./cohortTypes";
import { freshEstimate, runRequest, runVerdict, type Tray } from "./cohortProposalEdits";
import { useCohortMetered, useCohortRun } from "./useCohortRun";
import { useWalkthroughSource } from "./cohortWalkthroughSource";

const MORE_BTN = "focus-ring rounded-md font-semibold text-coral underline-offset-2 hover:underline";

export function CohortRunSheet({
  proposal,
  tray,
  onStarted,
}: {
  proposal: CohortProposal;
  tray: Tray;
  onStarted: (cohortId: string, request: CohortRunRequest) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.run");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [blind, setBlind] = useState(false);
  const [reportLang, setReportLang] = useState<string>(isLocale(locale) ? locale : LOCALES[0]);
  const [expanded, setExpanded] = useState(false);
  const walkthrough = useWalkthroughSource();
  const metered = useCohortMetered(!walkthrough);
  // CV analysis has no keyless engine: on an install without one, every FRESH member fails
  // (reused ones still compare). Said before Start, the same read the v1 form makes. The
  // walkthrough's run is simulated from fixture data, so no engine is needed and none is named.
  const engineRead = useEngineAvailabilityRead();
  const engineMissing = !walkthrough && Boolean(engineRead.engines && !engineRead.engines.gemini);
  const enginesUnknown = !walkthrough && engineRead.unknown;
  const { start, starting, failure } = useCohortRun(onStarted);
  const verdict = runVerdict(tray);
  const est = freshEstimate(tray);
  const reasonId = useId();
  const context = proposal.companyText;

  return (
    <aside aria-labelledby="cohort-run-h" className={`${PANEL} space-y-5 p-5 lg:sticky lg:top-4`}>
      <h3 id="cohort-run-h" className="font-serif text-h2 text-ink">
        {t("title")}
      </h3>

      <div className="space-y-1">
        <p className={META_LABEL}>{t("context")}</p>
        {context ? (
          <>
            <p className={`whitespace-pre-line text-body text-ink ${expanded ? "" : "line-clamp-4"}`}>{context}</p>
            <p className="text-micro text-steel">
              {proposal.orgName ? t("contextFromOrg", { org: proposal.orgName }) : t("contextFrom")}{" "}
              {context.length > 220 ? (
                <button type="button" onClick={() => setExpanded((e) => !e)} className={MORE_BTN}>
                  {expanded ? t("less") : t("more")}
                </button>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-body text-steel">{t("noContext")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 border-y border-stone-200 py-4">
        <div>
          <p className={`${STAT_VALUE} text-ink`}>{est.upperBound ? t("atMost", { n: est.fresh }) : est.fresh}</p>
          <p className="text-micro text-steel">{t("fresh", { n: est.fresh })}</p>
        </div>
        <div>
          <p className={`${STAT_VALUE} text-ink`}>{est.reused}</p>
          <p className="text-micro text-steel">{t("reused", { n: est.reused })}</p>
        </div>
        {metered === true && est.fresh > 0 ? (
          <p className="col-span-2 text-micro text-ink">{t(est.upperBound ? "unitsUpTo" : "units", { n: est.fresh })}</p>
        ) : null}
      </div>

      {est.fresh > 0 && (engineMissing || enginesUnknown) ? (
        <p role="status" className={`${NOTICE("amber")} px-3 py-2 text-body`}>
          {engineMissing ? t("engineMissing", { n: est.fresh }) : t("engineUnknown")}
        </p>
      ) : null}

      <Checkbox
        checked={blind}
        onChange={(e) => setBlind(e.target.checked)}
        label={t("blind")}
        hint={t("blindHint")}
        wrapperClassName="text-body text-ink"
      />
      <label className="flex items-center justify-between gap-3 text-body text-ink">
        {t("language")}
        <Select ariaLabel={t("language")} value={reportLang} onChange={setReportLang} sizeVariant="sm" options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))} />
      </label>

      {verdict !== "ok" ? (
        <p id={reasonId} className="text-body text-steel">
          {verdict === "empty" ? t("needSomeone", { min: COHORT_MIN }) : t("belowMin", { min: COHORT_MIN })}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-body text-coral">
          {errorMessage(failure, t("failed"), failure.values)}
        </p>
      ) : null}
      <button
        type="button"
        disabled={verdict !== "ok" || starting}
        aria-describedby={verdict !== "ok" ? reasonId : undefined}
        onClick={() => {
          const request = runRequest(proposal.jdSlug, tray, { blind, reportLang });
          if (walkthrough) onStarted(walkthrough.start(request), request);
          else void start(request);
        }}
        className={`${BTN_PRIMARY} h-10 w-full justify-center px-4 text-body disabled:cursor-not-allowed`}
      >
        <Play className="h-4 w-4" aria-hidden />
        {starting ? t("starting") : t("start", { n: tray.members.length })}
      </button>
    </aside>
  );
}
