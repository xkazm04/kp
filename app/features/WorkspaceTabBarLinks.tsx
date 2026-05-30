import Link from "next/link";
import { navItemClass, tabHref, WORKSPACE_TABS, type WorkspaceTabId } from "./tabs";

// Server-rendered tab strip for deep-link pages (history/[slug], jds/[slug]).
// Visually identical to the interactive Workspace tab bar but each tab is a
// Next Link back into the workspace at /?tab=<id>.

export function WorkspaceTabBarLinks({ active }: { active: WorkspaceTabId }) {
  return (
    <nav
      aria-label="Workspace tabs"
      className="rounded-lg border border-stone-200 bg-white p-1 shadow-panel"
    >
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
        {WORKSPACE_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={tabHref(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`focus-ring inline-flex h-10 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors ${navItemClass(isActive)}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
