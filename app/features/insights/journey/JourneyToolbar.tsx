"use client";

// Filters and find — one row of them, and nothing else.
//
// WHAT WAS HERE AND WHY IT IS GONE. A chip per role (which wrapped over two
// lines at six roles and is unusable at forty) and an eleven-item legend of
// every mark on the board. Measured at 1600x1000 the two of them cost 215px of
// a 1000px screen before a single journey row was drawn. Both are the owner's
// findings A1 and A2.
//
// The legend's DELETION is not a loss of the information, because the
// information was never only here: every mark on this board was already
// self-describing, by the rule the contest's winner was picked for — "a reader
// can tell an observed row from a generated one WITHOUT looking at the legend".
// Each of the eleven states still names itself, in the catalog, on the mark,
// without a hover:
//
//   human / machine / unidentified   `sr-only` in every row's accessible name
//                                    (JourneyRow, ACTOR_MARK_KEY) beside the
//                                    disc / square / dashed-diamond glyph
//   observed / from a test run       same `sr-only` clause; visually the solid
//                                    vs dotted left rule and the hatch
//   matched by name alone            same `sr-only` clause; visually the `≈`
//                                    and the wavy amber underline
//   nothing happened here            printed IN the band (JourneyAbsence 1)
//   never recorded                   printed IN the band (JourneyAbsence 2)
//   skipped                          `sr-only` on the cell (JourneyAbsence 4)
//   never reached                    printed IN the block (JourneyAbsence 5)
//   N days, nothing recorded         printed as its own row (JourneyRow)
//
// `journey.rail.note` STAYS, as one quiet line rather than a notice box. It is
// the statement that makes the single rail honest — steps are derived per role,
// so the same y in two clusters is not the same step — and the rail beside it
// names the role it is describing. Dropping it would leave one rail over a board
// of roles with nothing saying it is not one ladder for all of them.

import { useLocale, useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { CHIP_TOGGLE, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import {
  rolePickerOptions,
  selectedRole,
  withSelectedRole,
  type JourneyFilterState,
  type RolePickerRole,
} from "./journeyFilters";

export type JourneyToolbarProps = {
  filters: JourneyFilterState;
  onChange: (next: JourneyFilterState) => void;
  roles: RolePickerRole[];
};

export function JourneyToolbar({ filters, onChange, roles }: JourneyToolbarProps) {
  const t = useTranslations("journey");
  // `roleArea` is the canonical `jobs.role_family` slug; the picker shows the
  // same localized label the rest of the app does, and falls back to the slug
  // for a family the taxonomy does not know.
  const tEnums = useTranslations("enums");
  const locale = useLocale();
  const options = rolePickerOptions(roles, {
    allRoles: t("filters.allRoles"),
    ungrouped: t("filters.roleUngrouped"),
    areaLabel: (slug) => {
      const key = `family.${slug}` as Parameters<typeof tEnums>[0];
      return tEnums.has(key) ? tEnums(key) : slug;
    },
    collator: new Intl.Collator(locale, { numeric: true }),
  });

  return (
    <div className="shrink-0 border-b border-stone-200 bg-paper px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={META_LABEL}>{t("filters.role")}</span>
        {/* The app's own Select, not a native one: this board is a focus-trapped
            dialog, and a native <select>'s option popup is drawn by the OS and
            does not follow [data-theme]. It also gives the picker a filter box
            past eight options, which is the actual answer to "a company can
            have forty roles". */}
        <Select
          value={selectedRole(filters)}
          onChange={(jobId) => onChange(withSelectedRole(filters, jobId))}
          options={options}
          ariaLabel={t("filters.rolePicker")}
          sizeVariant="sm"
          className="w-64"
        />

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
            className={`${FIELD} h-9 w-56 py-1 text-sm`}
          />
        </label>
      </div>

      <p className="mt-1 text-xs leading-snug text-steel">
        {t("rail.note")}
      </p>
    </div>
  );
}
