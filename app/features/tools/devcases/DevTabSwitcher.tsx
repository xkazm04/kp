"use client";

// The Cases/Define need/Outbox sub-tab switcher, split out of DevTab.tsx.
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
  return (
    // data-sim anchor: Getting-started "show me" coachmark target (case design
    // starts at Define need).
    <div data-sim="dev-need" role="tablist" aria-label="Dev studio sections" className="inline-flex rounded-lg border border-stone-200 bg-paper p-0.5">
      {DEV_VIEWS.map((t) => {
        const active = view === t.id;
        const count = t.id === "cases" ? casesCount : t.id === "outbox" ? outboxCount : null;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
              active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
            }`}
          >
            {t.label}
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
