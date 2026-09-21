"use client";

// Filters, find, and the legend — all of it permanently on screen.
//
// THE LEGEND IS NOT THE POINT, AND THAT IS THE POINT. The winner's bar is that a
// reader can tell an observed row from a generated one WITHOUT looking here; the
// legend exists to teach the vocabulary once, and to give every mark on the
// board a visible, catalog-backed name that a `title=` attribute never could.
// Nothing on this board is reachable only by hovering: the contest panel named
// hover-only information as an anti-pattern, and it does not exist on touch or
// to a screen reader at all.
//
// `journey.rail.note` lives here rather than in each cluster: "steps differ
// between roles" is one statement about how every rail works, and repeating it
// four times would make it furniture.

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CHIP_TOGGLE, FIELD, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { ACTOR_GLYPH, NEVER_RECORDED_FILL, NEVER_REACHED_FILL, VOID_HATCH } from "./journeyMarks";
import { SILENCE_DAYS } from "./journeyLayout";
import type { JourneyFilterState } from "./journeyFilters";

export type JourneyToolbarProps = {
  filters: JourneyFilterState;
  onChange: (next: JourneyFilterState) => void;
  roles: { jobId: string; title: string }[];
  onJumpToRole: (jobId: string) => void;
};

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block h-3 w-6 shrink-0 rounded-sm border border-stone-300 ${className}`} aria-hidden="true" />;
}

function LegendItem({ children, mark }: { children: ReactNode; mark: ReactNode }) {
  return (
    <li className="flex items-center gap-2 whitespace-nowrap text-xs text-steel">
      {mark}
      <span>{children}</span>
    </li>
  );
}

export function JourneyToolbar({ filters, onChange, roles, onJumpToRole }: JourneyToolbarProps) {
  const t = useTranslations("journey");
  const allRoles = filters.roles.length === 0;

  return (
    <div className="shrink-0 border-b border-stone-200 bg-paper px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={META_LABEL}>{t("filters.role")}</span>
        <button
          type="button"
          aria-pressed={allRoles}
          onClick={() => onChange({ ...filters, roles: [] })}
          className={CHIP_TOGGLE(allRoles)}
        >
          {t("filters.allRoles")}
        </button>
        {roles.map((role) => {
          const on = filters.roles.includes(role.jobId);
          return (
            <span key={role.jobId} className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...filters,
                    roles: on ? filters.roles.filter((id) => id !== role.jobId) : [...filters.roles, role.jobId],
                  })
                }
                className={CHIP_TOGGLE(on)}
              >
                {role.title}
              </button>
              <button
                type="button"
                onClick={() => onJumpToRole(role.jobId)}
                className="focus-ring rounded px-1 text-xs text-steel underline hover:text-ink"
              >
                <span aria-hidden="true">&rarr;</span>
                <span className="sr-only">{role.title}</span>
              </button>
            </span>
          );
        })}

        <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden="true" />

        <button
          type="button"
          aria-pressed={filters.activeOnly}
          onClick={() => onChange({ ...filters, activeOnly: !filters.activeOnly })}
          className={CHIP_TOGGLE(filters.activeOnly)}
        >
          {t("filters.activeOnly")}
        </button>
        <button
          type="button"
          aria-pressed={filters.observedOnly}
          onClick={() => onChange({ ...filters, observedOnly: !filters.observedOnly })}
          className={CHIP_TOGGLE(filters.observedOnly)}
        >
          {t("filters.observedOnly")}
        </button>
        <button
          type="button"
          aria-pressed={filters.testRuns}
          onClick={() => onChange({ ...filters, testRuns: !filters.testRuns })}
          className={CHIP_TOGGLE(filters.testRuns)}
        >
          {t("filters.testRuns")}
        </button>

        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">{t("filters.find")}</span>
          <input
            type="search"
            value={filters.find}
            onChange={(event) => onChange({ ...filters, find: event.target.value })}
            placeholder={t("filters.find")}
            className={`${FIELD} w-56 text-sm`}
          />
        </label>
      </div>

      <p className={`${NOTICE("info")} mt-2 inline-block px-2 py-1 text-xs`} role="status">
        {t("rail.note")}
      </p>

      <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <LegendItem mark={<span className={ACTOR_GLYPH.human} />}>{t("mark.human")}</LegendItem>
        <LegendItem mark={<span className={ACTOR_GLYPH.machine} />}>{t("mark.machine")}</LegendItem>
        <LegendItem mark={<span className={ACTOR_GLYPH.unidentified} />}>{t("mark.unidentified")}</LegendItem>
        <LegendItem mark={<span className="h-3 w-0 border-l-2 border-solid border-ink" aria-hidden="true" />}>
          {t("mark.observed")}
        </LegendItem>
        <LegendItem mark={<span className="h-3 w-0 border-l-2 border-dotted border-ink" aria-hidden="true" />}>
          <em>{t("mark.testRun")}</em>
        </LegendItem>
        <LegendItem mark={<span aria-hidden="true">≈</span>}>
          <span className="underline decoration-wavy decoration-amber-600 underline-offset-4">
            {t("mark.labelOnly")}
          </span>
        </LegendItem>
        <LegendItem mark={<Swatch className={VOID_HATCH} />}>{t("absence.nothingHappened")}</LegendItem>
        <LegendItem mark={<Swatch className={NEVER_RECORDED_FILL} />}>{t("absence.neverRecorded")}</LegendItem>
        <LegendItem
          mark={<span className={`${NOTICE("amber")} inline-block h-3 w-6 shrink-0 rounded-sm border-dashed opacity-75`} aria-hidden="true" />}
        >
          {t("rail.skipped")}
        </LegendItem>
        <LegendItem mark={<Swatch className={NEVER_REACHED_FILL} />}>{t("rail.neverReached")}</LegendItem>
        <LegendItem mark={<span className="h-0 w-6 border-t border-dotted border-stone-300" aria-hidden="true" />}>
          <em>{t("silence", { days: SILENCE_DAYS })}</em>
        </LegendItem>
      </ul>
    </div>
  );
}
