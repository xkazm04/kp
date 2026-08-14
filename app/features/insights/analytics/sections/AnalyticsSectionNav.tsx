"use client";

// The Analytics tab's section switcher.
//
// Uses the shared SegmentedControl rather than a hand-rolled strip, so it
// arrives with radiogroup semantics (arrow-key roving focus, aria-checked) and
// the app's shared-layout pill motion already gated on reduced motion. Each
// option carries a one-line subtitle: the section names alone ("Economics")
// don't tell a first-time reader which of their questions lives where, and this
// switcher is the tab's whole navigation now.
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { ANALYTICS_SECTION_IDS, type AnalyticsSectionId } from "./analyticsSections";

export function AnalyticsSectionNav({
  section,
  onSection,
}: {
  section: AnalyticsSectionId;
  onSection: (id: AnalyticsSectionId) => void;
}) {
  const t = useTranslations("analytics.sections");
  return (
    <SegmentedControl<AnalyticsSectionId>
      label={t("label")}
      value={section}
      onChange={onSection}
      className="flex w-full flex-wrap gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-panel sm:w-auto"
      options={ANALYTICS_SECTION_IDS.map((id) => ({
        value: id,
        label: (
          <span className="flex flex-col items-start gap-0.5 px-1 py-0.5 text-left">
            <span className="text-base font-semibold leading-tight">{t(`${id}.name`)}</span>
            <span className="text-sm font-normal leading-tight opacity-70">{t(`${id}.hint`)}</span>
          </span>
        ),
      }))}
    />
  );
}
