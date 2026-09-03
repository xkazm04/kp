"use client";

// The Assignments/Define need/Outbox sub-tab switcher, split out of DevTab.tsx.
//
// The tablist's accessible name used to be the literal "Dev studio sections" — English
// for every reader, and the one place left on this surface still calling the module by
// the engineering team that built it rather than by what it holds. A screen-reader user
// heard a second name for a tab the sidebar calls Assignments.
import { useTranslations } from "next-intl";
import { DEV_VIEWS, type DevView } from "./DevTabViews";

export function DevTabSwitcher({
  view,
  onChange,
  casesCount,
  outboxCount,
}: {
  view: DevView;
  onChange: (view: DevView) => void;
  casesCount: number;
  outboxCount: number;
}) {
  const t = useTranslations("devcase.studio");
  return (
    // data-sim anchor: Getting-started "show me" coachmark target (case design
    // starts at Define need).
    <div data-sim="dev-need" role="tablist" aria-label={t("sectionsLabel")} className="inline-flex rounded-lg border border-stone-200 bg-paper p-0.5">
      {/* `tab`, not `t`: the translator owns that name here now. */}
      {DEV_VIEWS.map((tab) => {
        const active = view === tab.id;
        const count = tab.id === "cases" ? casesCount : tab.id === "outbox" ? outboxCount : null;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
              active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
            }`}
          >
            {t(tab.labelKey)}
            {count != null && count > 0 ? (
              <span className={`rounded-full px-1.5 text-micro nums ${active ? "bg-coral/10 text-coral" : "bg-stone-200/70 text-steel"}`}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
