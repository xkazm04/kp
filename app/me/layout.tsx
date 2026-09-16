import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { RailBrandMark } from "@/app/features/shell/nav/NavRailBrandMark";
import { RailPreferences } from "@/app/features/shell/nav/NavRailPreferences";

// /me — the job-seeker's own workspace, a THIN shell beside the recruiter Workspace
// (design wave 1, 2026-09-16: a separate route with its own shell, not a mode of the
// tab-driven shell). It reuses the root layout's providers (theme, locale, brand,
// toaster) and the two rail islands every shell shares — the brand mark and the
// appearance/language preferences — and nothing from app/features/shell/Workspace.tsx.
//
// Gate: the route is NOT in PUBLIC_PAGES, so proxy.ts already walls it when a
// password is set; this mirrors app/control/page.tsx and answers a demo-workspace
// session with the same 404 an unknown route gets rather than revealing the surface.
// `instant = false`: the layout reads the session and the locale per request.
export const instant = false;

const NAV = [
  { href: "/me", key: "profile" },
  { href: "/me/jobs", key: "jobs" },
  { href: "/me/sources", key: "sources" },
  { href: "/me/scans", key: "scans" },
] as const;

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOperator())) notFound();
  const t = await getTranslations("me");
  return (
    <div className="min-h-screen bg-paper md:flex">
      <nav aria-label={t("title")} className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r md:py-6">
        <RailBrandMark />
        <ul className="flex flex-1 gap-2 md:flex-col md:gap-1">
          {NAV.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-stone-50">
                {t(`nav.${item.key}`)}
              </Link>
            </li>
          ))}
        </ul>
        <RailPreferences />
      </nav>
      <main className="flex-1">
        <div className="mx-auto max-w-[108rem] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
