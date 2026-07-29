"use client";

// The "write" mode fieldset of SetupFirstRoleStep, split out so the step stays
// under the 200-line file cap. Verbatim markup — same inputs, same what's-included
// chip list.
import { Check } from "lucide-react";
import type { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Select } from "@/app/_components/Select";
import { TextArea } from "@/app/_components/TextArea";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import type { useEnumLabel } from "@/app/_lib/use-enum-label";
import { SENIORITY_OPTIONS, type RoleDraft } from "./setupSteps";
import { Req } from "./SetupRequiredMarker";

const INCLUDED = ["description", "salary", "case"] as const;

export function SetupFirstRoleWriteFields({
  role,
  setRole,
  t,
  enumLabel,
}: {
  role: RoleDraft;
  setRole: (patch: Partial<RoleDraft>) => void;
  t: ReturnType<typeof useTranslations>;
  enumLabel: ReturnType<typeof useEnumLabel>;
}) {
  return (
    <>
      <div>
        <span className={`${META_LABEL} block`}>{t("seniorityLabel")}</span>
        <div className="mt-1">
          <SegmentedControl
            label={t("seniorityLabel")}
            value={role.seniority}
            onChange={(seniority) => setRole({ seniority })}
            options={SENIORITY_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
      </div>

      {/* Standalone row: family labels run long ("Operations / Logistics"), so
          the select gets a generous fixed width instead of sharing a row. */}
      <div>
        <span className={`${META_LABEL} block`}>{t("familyLabel")}</span>
        <div className="mt-1">
          <Select
            value={role.roleFamily}
            onChange={(roleFamily) => setRole({ roleFamily })}
            ariaLabel={t("familyLabel")}
            className="w-96 max-w-full"
            options={ROLE_FAMILY_SLUGS.map((slug) => ({ value: slug, label: enumLabel("family", slug) }))}
          />
        </div>
      </div>

      <div>
        <label htmlFor="setup-role-need" className={`${META_LABEL} block`}>
          {t("needLabel")}
          <Req />
        </label>
        <TextArea
          id="setup-role-need"
          aria-required
          value={role.needText}
          onChange={(e) => setRole({ needText: e.target.value })}
          rows={4}
          placeholder={t("needPlaceholder")}
          className="mt-1"
        />
        <p className="mt-1 text-sm text-steel">{t("needHint")}</p>
      </div>

      <div>
        <span className={`${META_LABEL} block`}>{t("includedLabel")}</span>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {INCLUDED.map((key) => (
            <li key={key} className={`${CHIP_QUIET} inline-flex items-center gap-1`}>
              <Check size={12} aria-hidden className="text-moss" /> {t(`included.${key}`)}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-sm text-steel">{t("background")}</p>
      </div>
    </>
  );
}
