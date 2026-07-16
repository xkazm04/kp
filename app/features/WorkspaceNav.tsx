import { attentionCounts, type AttentionCounts } from "@/app/_lib/attention";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { SignOutButton } from "@/app/_components/auth/SignOutButton";
import { RecentsNav } from "./RecentsNav";
import { RailBrandMark } from "./nav/RailBrandMark";
import { SectionRailNav } from "./nav/SectionRailNav";
import { NAV_GROUPS, type WorkspaceTabId } from "./tabs";

// Link-mode two-level sidebar for server-rendered deep-link pages (/jds/[slug],
// /history/[slug], /diagrams). It renders the SAME SectionRailNav structure as the
// interactive shell (icon rail + per-group panel) — so following a deep link no longer
// swaps the nav STRUCTURE mid-flow — but as real anchors to /?tab=<id> rather than the
// SPA's client tab-switch. No flat single-column markup lives here anymore; this is a
// thin wrapper over the one shared renderer.
//
// Server Component (server-side attention counts). It hands SectionRailNav only
// serializable props + the chrome slots; i18n labels and the badge-slice hrefs resolve
// INSIDE the client renderer (a Server Component can't pass a client component a
// function — a navText/onSelect callback), which is exactly why the shared renderer
// self-resolves them. The TasksIndicator + CommandPalette are SPA-only and
// intentionally omitted here.
export function WorkspaceNav({ active }: { active: WorkspaceTabId }) {
  // SHELL2 — same badge counts as the interactive shell, computed server-side at
  // render (a detail page is a snapshot; the SPA shell owns the live poll). Best-effort:
  // a store fault must not take the whole page down for a badge.
  let attention: AttentionCounts | null = null;
  try {
    attention = attentionCounts();
  } catch (error) {
    console.error("[WorkspaceNav] attention counts unavailable", error);
  }
  return (
    <aside className="flex border-b border-stone-300 bg-paper md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:overflow-hidden md:border-b-0 md:border-r">
      <SectionRailNav
        mode="link"
        groups={NAV_GROUPS}
        navActive={active}
        attention={attention}
        // A detail page carries no live tab query — compose the badge-slice hrefs off an
        // empty search, exactly as the flat renderer did.
        search=""
        railTop={
          // Client island — reads the server-seeded brand context (BrandProvider) so a
          // white-label logo shows on the rail; falls back to the KandiDate mark.
          <RailBrandMark />
        }
        panelHeader={
          // SHELL3: same Recent group as the interactive shell — a client island, since
          // localStorage is unreachable from this server component.
          <RecentsNav />
        }
        panelFooter={
          <>
            {/* Theme flip works on detail pages too — a client island like RecentsNav. */}
            <div className="border-t border-stone-200 px-3 py-2.5">
              <ThemeToggle />
            </div>
            {/* Drop the dev session and return to the landing. */}
            <div className="border-t border-stone-200 px-3 py-2">
              <SignOutButton />
            </div>
          </>
        }
      />
    </aside>
  );
}

// Sidebar + main content wrapper matching the Workspace layout (same max width,
// padding and background) so a detail page looks like a tab.
export function WorkspaceShell({ active, children }: { active: WorkspaceTabId; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper md:flex">
      <WorkspaceNav active={active} />
      <main className="min-w-0 flex-1 bg-paper">
        <div className="mx-auto max-w-[108rem] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
