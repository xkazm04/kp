import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { attentionCounts, type AttentionCounts } from "@/app/_lib/attention";
import { RecentsNav } from "./RecentsNav";
import { navItemClass, NAV_GROUPS, tabHref, type WorkspaceTabId } from "./tabs";

// Link-based copy of the Workspace sidebar for server-rendered deep-link pages
// (e.g. /jds/[slug], /history/[slug]) so they carry the same left nav + styling
// as the interactive tabs. Items are Links (full navigation back into the SPA)
// rather than the SPA's client tab-switch; the TasksIndicator is SPA-only and
// intentionally omitted here.
export async function WorkspaceNav({ active }: { active: WorkspaceTabId }) {
  const t = await getTranslations("nav");
  // SHELL2 — same badge counts as the interactive shell, computed server-side
  // at render (a detail page is a snapshot; the SPA shell owns the live poll).
  // Best-effort: a store fault must not take the whole page down for a badge.
  let attention: AttentionCounts | null = null;
  try {
    attention = attentionCounts();
  } catch (error) {
    console.error("[WorkspaceNav] attention counts unavailable", error);
  }
  // Mirror of Workspace.tsx navText: translate by nav key, fall back to the
  // English label in tabs.ts so the two sidebars read identically.
  const navText = (key: string, fallback: string): string => {
    const k = key as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : fallback;
  };
  return (
    <aside className="flex flex-col border-b border-stone-300 bg-paper md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
      <Link href="/" className="focus-ring px-4 py-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-serif text-base font-semibold text-white">{t("brandMark")}</span>
          <div className="leading-tight">
            <p className="font-serif text-h3 text-ink">{t("brandName")}</p>
            <p className="text-sm uppercase tracking-[0.12em] text-steel">{t("tagline")}</p>
          </div>
        </div>
      </Link>

      {/* SHELL3: same Recent group as the interactive shell — a client island,
          since localStorage is unreachable from this server component. */}
      <RecentsNav />

      <nav aria-label={t("ariaLabel")} className="space-y-5 px-3 pb-6">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.key ?? `g${gi}`}>
            {group.key ? (
              <p className="px-2 pb-1 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
                {navText(`groups.${group.key}`, group.label ?? "")}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.id === active;
                const badge = item.badgeKey && attention ? attention[item.badgeKey] : 0;
                return (
                  <Link
                    key={item.id}
                    href={tabHref(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(isActive)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{navText(`tabs.${item.id}`, item.label)}</span>
                    {badge > 0 ? (
                      <span
                        aria-label={t("attentionBadge", { count: badge })}
                        className="shrink-0 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral"
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

// Sidebar + main content wrapper matching the Workspace layout (same max width,
// padding and background) so a detail page looks like a tab.
export function WorkspaceShell({ active, children }: { active: WorkspaceTabId; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper md:flex">
      <WorkspaceNav active={active} />
      <main className="min-w-0 flex-1 bg-white">
        <div className="mx-auto max-w-[108rem] px-3 py-6 sm:px-4 lg:px-6">{children}</div>
      </main>
    </div>
  );
}
