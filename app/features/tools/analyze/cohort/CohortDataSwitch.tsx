"use client";

// DEV ONLY (CohortStudio mounts it when NODE_ENV is not production): where the comparison comes
// from — the live flow, one of the engine's committed fixtures, or the keyless walkthrough.
// Mirrors ?cohortFixture=. Production never draws it and always reads live data.
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { COHORT_FIXTURE_MODES, type CohortFixtureMode } from "./cohortShell";

const BAR = "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-dashed border-stone-300 px-4 py-2 dark:rounded-2xl";

export function CohortDataSwitch({ fixture, onFixture }: { fixture: CohortFixtureMode; onFixture: (f: CohortFixtureMode) => void }) {
  const t = useTranslations("analyzeCohort.shell.dev");
  return (
    <div className={BAR} data-cohort-dev>
      <div className="flex flex-wrap items-center gap-3">
        <span className={META_LABEL}>{t("data")}</span>
        <SegmentedControl
          label={t("data")}
          value={fixture}
          onChange={onFixture}
          options={COHORT_FIXTURE_MODES.map((f) => ({ value: f, label: t(`mode.${f}`) }))}
        />
      </div>
      <span className="text-micro text-steel">{t("note")}</span>
    </div>
  );
}
