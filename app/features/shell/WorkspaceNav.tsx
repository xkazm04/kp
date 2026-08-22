import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { attentionCounts, type AttentionCounts } from "@/app/_lib/attention";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { SignOutButton } from "@/app/_components/auth/SignOutButton";
import { CommandPalette } from "./WorkspaceCommandPalette";
import { NavFeedbackButton } from "./nav/NavFeedbackButton";
import { RailBrandMark } from "./nav/NavRailBrandMark";
import { RailPreferences } from "./nav/NavRailPreferences";
import { NavSectionRail } from "./nav/NavSectionRail";
import { NAV_GROUPS, type WorkspaceTabId } from "./tabs";

// Link-mode two-level sidebar for server-rendered deep-link pages (/jds/[slug],
// /history/[slug], /diagrams). It renders the SAME NavSectionRail structure as the
// interactive shell (icon rail + per-group panel) — so following a deep link no longer
// swaps the nav STRUCTURE mid-flow — but as real anchors to /?tab=<id> rather than the
// SPA's client tab-switch. No flat single-column markup lives here anymore; this is a
// thin wrapper over the one shared renderer.
//
// Server Component (server-side attention counts). It hands NavSectionRail only
// serializable props + the chrome slots; i18n labels and the badge-slice hrefs resolve
// INSIDE the client renderer (a Server Component can't pass a client component a
// function — a navText/onSelect callback), which is exactly why the shared renderer
// self-resolves them. The TasksIndicator is SPA-only and intentionally omitted here;
// the CommandPalette (rail search) mounts on both.
export async function WorkspaceNav({ active }: { active: WorkspaceTabId }) {
  // Who is looking. NOT a prop: one of this nav's three hosts — /jds/[slug] — is on
  // the PUBLIC allow-list (public-routes.ts), so a page that forgot to pass the flag
  // would silently re-open the leak below. The nav owns its own gate instead.
  //
  // The leak it closes: an anonymous candidate on a shared role link renders this
  // sidebar, and `currentWorkspace()` resolves a cookieless caller to
  // DEFAULT_WORKSPACE — so `curl https://host/jds/<slug>` with no cookies came back
  // with the default team's real queue depths (entries awaiting a human decision,
  // entries past their stage SLA, confirmed future interviews, unpublished draft
  // roles, new inbound arrivals) rendered as bare integers in NavPanelItem.
  //
  // Open mode (KP_OPERATOR_PASSWORD unset) is true for everyone by design, so this
  // changes nothing on a keyless/dev install — only a password-protected deploy,
  // which is exactly where the anonymous visitor is a real, distinct principal.
  const operator = await isOperator();

  // SHELL2 — same badge counts as the interactive shell, computed server-side at
  // render (a detail page is a snapshot; the SPA shell owns the live poll). Best-effort:
  // a store fault must not take the whole page down for a badge.
  let attention: AttentionCounts | null = null;
  if (operator) {
    try {
      // Same tenant scope as /api/attention: the badges describe the workspace this
      // session is signed into, never the default one.
      attention = attentionCounts(await currentWorkspace());
    } catch (error) {
      console.error("[WorkspaceNav] attention counts unavailable", error);
    }
  }
  const t = await getTranslations("nav");
  return (
    <>
      {/* <md: the full two-level rail used to render as a block ABOVE the page
          content — a screenful of admin nav before the deep-linked JD/report.
          These are destination pages, not workspaces, so below md the nav
          collapses to a slim brand bar with one link back into the app. */}
      <div className="flex items-center justify-between border-b border-stone-300 bg-paper px-4 py-2.5 md:hidden">
        <RailBrandMark />
        <Link
          href="/"
          className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
        >
          {t.has("openWorkspace") ? t("openWorkspace") : "Open workspace"}
        </Link>
      </div>
      <aside className="hidden bg-paper md:sticky md:top-0 md:flex md:h-screen md:w-72 md:shrink-0 md:overflow-hidden md:border-r md:border-stone-300">
      <NavSectionRail
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
        // Theme, language and sign-out flip/act on detail pages too — client
        // islands, and now the SAME controls as the interactive
        // shell (the old panel footer here carried the theme toggle but no
        // language switcher). The TasksIndicator stays SPA-only, so this sidebar
        // has no panel footer at all.
        //
        // Search / feedback / sign-out are OPERATOR controls and render only for one
        // (see `operator` above). On the public JD share link they were all three
        // wrong for the viewer: the palette searches the workspace's candidates and
        // roles behind a gated /api/search, the feedback door is the recruiter's, and
        // "Sign out" offered a candidate who never had a session a button that POSTs
        // /api/auth/logout and hard-navigates them off the job ad they were reading.
        // Appearance/language are viewer chrome and stay for everyone.
        railFooter={
          <>
            {operator ? (
              <>
                {/* Global search on every route — same rail button + Ctrl/Cmd+K as the
                    SPA shell (the tour command is absent here: no SimulationProvider).
                    Suspense: the palette reads useSearchParams from a client island. */}
                <Suspense fallback={null}>
                  <CommandPalette />
                </Suspense>
                <NavFeedbackButton />
              </>
            ) : null}
            <RailPreferences />
            {/* Drop the dev session and return to the landing. */}
            {operator ? <SignOutButton /> : null}
          </>
        }
      />
      </aside>
    </>
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
