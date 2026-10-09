"use client";

// Add someone by hand: put back a proposal member taken out (with the rule that seated them),
// or seat a candidate from the workspace's population (any CV already analysed, matched by
// name). At the cap the control stays visible, disabled, and says why — no hover needed. In the
// walkthrough the population is the fixture's (useWalkthroughSource) and nothing is fetched.
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search } from "lucide-react";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { BTN_GHOST, BTN_SECONDARY, FIELD, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useCandidatePopulation } from "@/app/features/tools/profile/useCandidatePopulation";
import { COHORT_CAP } from "./cohortTypes";
import { memberFromPopulation, populationOffer, trayIsFull, type Tray, type TrayMember } from "./cohortProposalEdits";
import { useWalkthroughSource } from "./cohortWalkthroughSource";

const ROW = "flex items-center justify-between gap-3 py-1";

export function CohortAddMember({ tray, onAdd }: { tray: Tray; onAdd: (member: TrayMember) => void }) {
  const t = useTranslations("analyzeCohort.shell.add");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const reasonId = useId();
  const full = trayIsFull(tray);
  const walkthrough = useWalkthroughSource();
  const live = useCandidatePopulation({ active: open && !walkthrough });
  const population = walkthrough ? { rows: walkthrough.population, failed: false, reload: live.reload } : live;
  const offer = population.rows ? populationOffer(population.rows, tray, query) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={full && !open}
          aria-expanded={open}
          aria-describedby={full ? reasonId : undefined}
          className={`${BTN_SECONDARY} h-9 px-4 text-body`}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {open ? t("close") : t("open")}
        </button>
        {full ? (
          <p id={reasonId} className="text-body text-steel">
            {t("full", { cap: COHORT_CAP })}
          </p>
        ) : null}
      </div>
      {open ? (
        <div className={`${PANEL_SUNKEN} space-y-3 p-4`}>
          {tray.removed.length > 0 ? (
            <div className="space-y-1">
              <h4 className={META_LABEL}>{t("removed")}</h4>
              <ul>
                {tray.removed.map((m) => (
                  <li key={m.memberId} className={ROW}>
                    <span className="min-w-0 truncate text-body text-ink">
                      {m.label} <span className="text-steel">· {t(`was.${m.membership}`)}</span>
                    </span>
                    <button type="button" disabled={full} onClick={() => onAdd(m)} aria-label={t("putBackNamed", { name: m.label })} className={`${BTN_GHOST} h-9 shrink-0 px-3 text-body`}>
                      {t("putBack")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="relative block max-w-sm">
            <span className="sr-only">{t("search")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className={`${FIELD} h-10 w-full pl-9`} />
          </label>
          {population.rows === null && !population.failed ? <LoadingGap className="min-h-[6rem]" label={t("loading")} /> : null}
          {population.failed ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-body text-coral">
              {t("failed")}
              <button type="button" onClick={population.reload} className={`${BTN_GHOST} h-9 px-3 text-body`}>
                {t("retry")}
              </button>
            </p>
          ) : null}
          {population.rows && offer.length === 0 ? <p className="text-body text-steel">{query.trim() ? t("noMatch") : t("nobodyElse")}</p> : null}
          {offer.length > 0 ? (
            <ul aria-label={t("offerLabel")}>
              {offer.map((row) => {
                const member = memberFromPopulation(row);
                return member ? (
                  <li key={row.key} className={ROW}>
                    <span className="min-w-0 truncate text-body text-ink">{row.name}</span>
                    <button type="button" disabled={full} onClick={() => onAdd(member)} aria-label={t("addNamed", { name: row.name })} className={`${BTN_GHOST} h-9 shrink-0 px-3 text-body`}>
                      {t("add")}
                    </button>
                  </li>
                ) : null;
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
