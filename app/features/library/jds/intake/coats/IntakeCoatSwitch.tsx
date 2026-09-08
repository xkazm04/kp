"use client";

import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { INTAKE_COAT_IDS } from "./coatKit";
import type { IntakeCoatId } from "./coatKit";

// The prototype's own chrome, and the one place on this surface where a plain
// word beats a glyph: three coats named by their metaphor cannot be guessed
// from three icons, and a reviewer comparing directions should never have to
// hover to find out which one they are looking at. It is scaffold — it leaves
// with the losing coats.

export function IntakeCoatSwitch({ coat, onChange }: { coat: IntakeCoatId; onChange: (next: IntakeCoatId) => void }) {
  const t = useTranslations("library.tab.intake.coat");

  return (
    <SegmentedControl<IntakeCoatId>
      label={t("label")}
      value={coat}
      onChange={onChange}
      options={INTAKE_COAT_IDS.map((id) => ({ value: id, label: t(`name.${id}`) }))}
      className="inline-flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5"
    />
  );
}
