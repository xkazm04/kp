"use client";

import { useTranslations } from "next-intl";
import Wordmark from "../Wordmark";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";

/*
 * Landing topbar — destinations only.
 *
 * The in-page section anchors (#how / #features / #pricing) used to sit here
 * next to /about and /market, competing with the links that actually leave the
 * page. They live in the scroll-revealed SectionRail now.
 */
export default function Topbar() {
  const t = useTranslations("landing");
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6">
      <Wordmark />
      <nav className="hidden items-center gap-6 text-[15px] font-bold sm:flex">
        <a href="/about" className="hover:text-[#d65a4a]">
          {t("nav.about")}
        </a>
        <a href="/market" className="hover:text-[#d65a4a]">
          {t("nav.market")}
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
    </header>
  );
}
