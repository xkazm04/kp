"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Briefcase, Radar, Rss, UserRound, type LucideIcon } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { railTile } from "@/app/_components/ui/recipes";
import { RailBrandMark } from "@/app/features/shell/nav/NavRailBrandMark";
import { RailPreferences } from "@/app/features/shell/nav/NavRailPreferences";
import { MeNavDrawer } from "./MeNavDrawer";

// The /me rail IS the house rail — the same 4.75rem icon column the recruiter
// workspace wears (NavSectionRail's level 1), composed from the same `railTile`
// recipe, the same RailBrandMark at the top and the same RailPreferences in the
// footer slot. It was a flat md:w-56 list of hand-typed classes, which is how the
// active item lost the dark outline `railTile` carries and how the preferences
// popover — positioned for a 4.75rem rail (`left-full`) — ended up flying over the
// page from inside a 14rem column.
//
// ONE LEVEL, on purpose. NavSectionRail's second level exists because ~20 modules
// in one column is unreadable; four destinations are not that, so /me stops at the
// rail. Nothing here forks NavSectionRail or widens its WorkspaceTabDef typing (its
// items are tab ids pinned by tests) — the recipes and the structure are what is
// inherited.
//
// Real anchors (middle-click, open-in-tab) and the active state from the pathname —
// there is no tab store here, the URL IS the state. So these are `<nav><ul>` links
// carrying `aria-current="page"`, NOT a tablist: a tablist promises same-document
// panels and roving-arrow focus management, and a link that loads a new document
// keeps the navigation role it really has.
//
// On a phone the column becomes a top bar + off-canvas drawer (MeNavDrawer), the
// WorkspaceNavDrawer shape, and the whole thing is `print:hidden`.

const NAV: { href: string; key: "profile" | "jobs" | "sources" | "scans"; Icon: LucideIcon }[] = [
  { href: "/me", key: "profile", Icon: UserRound },
  { href: "/me/jobs", key: "jobs", Icon: Briefcase },
  { href: "/me/sources", key: "sources", Icon: Rss },
  { href: "/me/scans", key: "scans", Icon: Radar },
];

function isActive(pathname: string, href: string): boolean {
  // /me is the profile page and the root of the rest; only an exact match lights it.
  if (href === "/me") return pathname === "/me" || pathname.startsWith("/me/cv");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The four destinations as rail tiles. `onNavigate` closes the mobile drawer — the
 *  desktop rail passes nothing, because it never opened. */
function MeNavTiles({ jobsNew, onNavigate }: { jobsNew: number; onNavigate?: () => void }) {
  const t = useTranslations("me.nav");
  const pathname = usePathname() ?? "/me";
  return (
    <ul className="flex flex-1 flex-col gap-1">
      {NAV.map(({ href, key, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={key}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              // `relative` is the tile's own (the badge is pinned to its corner);
              // everything else — sizing, radius, the coral active wash and the dark
              // outline that goes with it — is the recipe's.
              className={`relative ${railTile(active)}`}
            >
              <Icon size={20} aria-hidden />
              {/* The rail's own label size: 13px semibold, one step under the body
                  floor because a 4.75rem tile cannot hold a 14px word. */}
              <span className="text-[13px] font-semibold leading-tight">{t(key)}</span>
              {key === "jobs" && jobsNew > 0 ? (
                <Badge
                  tone="info"
                  label={String(jobsNew)}
                  ariaLabel={t("jobsNew", { count: jobsNew })}
                  className="nums absolute right-1 top-1"
                />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The rail column itself: brand slot, tiles, preferences footer. Rendered twice —
 *  permanently at md+, and inside the mobile drawer — from one definition, so the
 *  two can no longer drift. */
function MeNavRail({
  label,
  jobsNew,
  brand,
  onNavigate,
}: {
  label: string;
  jobsNew: number;
  /** RailBrandMark is `hidden md:flex`, so the drawer passes nothing and the mobile
   *  top bar carries the mark instead. */
  brand?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label} className="flex h-full w-[4.75rem] shrink-0 flex-col gap-1 bg-paper p-2">
      {brand}
      <MeNavTiles jobsNew={jobsNew} onNavigate={onNavigate} />
      {/* The rail's bottom slot, exactly as NavSectionRail draws it: a hairline, then
          the appearance/language popovers — which anchor `left-full` off a 4.75rem
          rail and therefore only land correctly here. */}
      <div className="mt-auto flex flex-col items-center gap-1 border-t border-stone-200 pt-1.5">
        <RailPreferences />
      </div>
    </nav>
  );
}

/** `jobsNew` is the DERIVED count of postings that arrived after the seeker's feed
 *  anchor, read server-side by the layout (no client fetch, so the rail never flashes a
 *  number in). Zero — and a seeker with no anchor yet, who is handed 0 — shows nothing:
 *  a badge reading "0" is noise, and a first visit has nothing to be behind on. */
export function MeNav({ label, jobsNew = 0 }: { label: string; jobsNew?: number }) {
  return (
    <>
      {/* Permanent rail at md+ — the workspace's own sidebar border token. */}
      <div className="hidden bg-paper md:sticky md:top-0 md:flex md:h-screen md:shrink-0 md:border-r md:border-stone-300 print:hidden">
        <MeNavRail label={label} jobsNew={jobsNew} brand={<RailBrandMark />} />
      </div>
      <MeNavDrawer rail={(close) => <MeNavRail label={label} jobsNew={jobsNew} onNavigate={close} />} />
    </>
  );
}
