"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Briefcase, Radar, Rss, UserRound, type LucideIcon } from "lucide-react";
import { RailBrandMark } from "@/app/features/shell/nav/NavRailBrandMark";
import { RailPreferences } from "@/app/features/shell/nav/NavRailPreferences";
import { navItemClass } from "@/app/features/shell/tabs";

// The /me rail: brand mark, four destinations, the appearance + language
// preferences. Real anchors (middle-click, open-in-tab) and the active state from
// the pathname — there is no tab store here, the URL IS the state. On a phone the
// column becomes a top bar, the WorkspaceNav shape.

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

export function MeNav({ label }: { label: string }) {
  const t = useTranslations("me.nav");
  const pathname = usePathname() ?? "/me";
  return (
    <nav
      aria-label={label}
      className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 md:sticky md:top-0 md:h-screen md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r md:py-6 print:hidden"
    >
      <RailBrandMark />
      <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {NAV.map(({ href, key, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`focus-ring flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${navItemClass(active)}`}
              >
                <Icon size={16} aria-hidden className="shrink-0" />
                <span className="truncate">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-1 md:mt-auto md:flex-col md:items-stretch">
        <RailPreferences />
      </div>
    </nav>
  );
}
