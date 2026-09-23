"use client";

// The cohort layer: the level ABOVE the journey board. Every journey in the workspace on
// one derived path - how far candidates get, and where the process loses them. One job per
// surface: picking a role is a dropdown (the list of roles only grows), and meeting the
// candidates behind a stage is the board's job, one level down.

import { useMemo, useState } from "react";
import { ArrowDownRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { BTN_PRIMARY, INTRO, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { buildSpine } from "./spine";
import { hiringFailure, hiringInstances } from "./hiringAdapter";
import { useJourneyCohort } from "./useJourneyCohort";
import { CohortStation } from "./CohortStation";
import { CohortOutcomes, CohortSummary } from "./CohortSummary";

const ALL = "__all__";

export function JourneyCohortView({ onOpenBoard }: { onOpenBoard: (jobId: string | null) => void }) {
  const t = useTranslations("journey.cohort");
  const { cohort, loading, error } = useJourneyCohort();
  const [role, setRole] = useState(ALL);

  const all = useMemo(() => (cohort ? hiringInstances(cohort) : []), [cohort]);
  const view = useMemo(() => (role === ALL ? all : all.filter((x) => x.jobId === role)), [all, role]);
  const base = useMemo(() => buildSpine(all, hiringFailure), [all]);
  const model = useMemo(() => (role === ALL ? base : buildSpine(view, hiringFailure, all)), [role, view, all, base]);
  const roleTitle = cohort?.roles.find((r) => r.jobId === role)?.title ?? "";

  if (!cohort) {
    if (error) return <p className={`${PANEL_SUNKEN} m-6 p-6 text-body text-red-700`} role="alert">{error}</p>;
    return loading ? <CohortGhost /> : null;
  }

  const options = [
    { value: ALL, label: t("roleAll", { count: cohort.instances.length }) },
    ...cohort.roles.map((r) => ({ value: r.jobId, label: `${r.title || t("roleUnassigned")} (${r.n})` })),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8" data-testid="journey-cohort">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <p className="text-h3 text-ink">
            {role === ALL
              ? t("subtitleAll", { count: view.length, roles: cohort.roles.length })
              : t("subtitleRole", { count: view.length, role: roleTitle })}
          </p>
          <p className={`${INTRO} mt-1 max-w-3xl`}>{t("pathNote")} {t("timeNote")}</p>
          {cohort.capped && <p className="mt-1 text-meta text-amber-800">{t("capped", { n: cohort.instances.length, total: cohort.scanned })}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Select value={role} onChange={setRole} options={options} ariaLabel={t("roleLabel")} className="w-72" searchable />
          <button type="button" className={`${BTN_PRIMARY} px-3 py-2 text-sm`} onClick={() => onOpenBoard(role === ALL ? null : role)} data-testid="journey-cohort-open-board">
            {role === ALL ? t("openBoard") : t("openRoleBoard")}
            <ArrowDownRight size={16} aria-hidden />
          </button>
        </div>
      </div>

      {view.length === 0 ? (
        <p className="py-16 text-center text-body text-steel">{t("empty")}</p>
      ) : (
        <>
          <CohortSummary model={model} />
          <ol className="mt-10" aria-label={t("pathLabel")}>
            {model.stations.map((s, i) => (
              <CohortStation
                key={s.keys.join("|")}
                station={s}
                total={model.n}
                cohort={role === ALL ? undefined : base.stations[i]}
                cohortTotal={role === ALL ? undefined : base.n}
                rank={model.worst.slice(0, 3).includes(s.index) ? model.worst.indexOf(s.index) + 1 : undefined}
                last={i === model.stations.length - 1}
              />
            ))}
          </ol>
          <CohortOutcomes outcomes={model.outcomes} total={model.n} />
        </>
      )}
    </div>
  );
}

function CohortGhost() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse space-y-10 px-6 py-8" aria-hidden="true">
      <div className="h-16 rounded-lg bg-stone-100" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[minmax(8rem,12rem)_4rem_minmax(0,1fr)] gap-x-8">
          <span className="ml-auto h-7 w-28 rounded bg-stone-100" />
          <span className="mx-auto h-24 w-8 rounded bg-stone-100" />
          <span className="h-16 rounded bg-stone-100" />
        </div>
      ))}
    </div>
  );
}
