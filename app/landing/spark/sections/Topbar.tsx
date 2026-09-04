"use client";

import { useTranslations } from "next-intl";
import Wordmark from "../Wordmark";
import MobileNav from "./MobileNav";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { sourceRepoHref } from "@/app/_lib/source-repo";

/*
 * Landing topbar — destinations only.
 *
 * The in-page section anchors (#how / #features / #pricing) used to sit here
 * next to /about and /market, competing with the links that actually leave the
 * page. They live in the scroll-revealed SectionRail now.
 *
 * Both of those surfaces are breakpoint-gated (`sm:flex` here, `lg:block` for
 * the rail), which left a phone with no navigation whatsoever — so the same
 * destinations, plus the rail's five section anchors, hang off ./MobileNav's
 * disclosure below `sm`.
 */
export default function Topbar() {
  const t = useTranslations("landing");
  return (
    <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 pt-6">
      <Wordmark />
      <nav className="hidden items-center gap-6 text-[17px] font-bold sm:flex">
        <a href="/about" className="hover:text-[#d65a4a]">
          {t("nav.about")}
        </a>
        <a href="/market" className="hover:text-[#d65a4a]">
          {t("nav.market")}
        </a>
        {/* The source. An AGPL product that hides its repository is answering the
            visitor's second question ("can I just run this myself?") with silence —
            and §13 expects a running instance to point at its source anyway. */}
        <a href={sourceRepoHref()} target="_blank" rel="noopener noreferrer" className="hover:text-[#d65a4a]">
          {t("nav.source")}
        </a>
        {/* Sign in — the app ships open to all, so this is the single entry
            point. In development it flips the localStorage gate and drops you
            straight into the dashboard; in production it hands off to the real
            password sign-in. */}
        <button
          type="button"
          onClick={() => void enterWorkspace()}
          className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
        >
          {t("nav.signIn")}
        </button>
      </nav>
      <MobileNav />
    </header>
  );
}
