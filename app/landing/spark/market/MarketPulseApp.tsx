"use client";

/*
 * Market Pulse host — shared Spark chrome (header, hero, CC BY attribution
 * footer) around the page body. Fixed Spark art direction (literal hexes, the
 * docs/design/README.md exemption); all copy resolves through the `jobMarket` i18n
 * namespace. The "Atlas" direction won the prototype round, so the body is the
 * map-led editorial scroll; the earlier variant switcher has been consolidated
 * away.
 */
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Wordmark from "../Wordmark";
import { LandingLangSwitch } from "../LandingLangSwitch";
import { DISPLAY, HAND } from "../tokens";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { snapshot, fmtDate } from "./data";
import MarketPulseAtlas from "./MarketPulseAtlas";

export default function MarketPulseApp() {
  const t = useTranslations("jobMarket");
  const [menuOpen, setMenuOpen] = useState(false);
  const onSignIn = () => {
    setMenuOpen(false);
    void enterWorkspace();
  };
  const coralEmph = (chunks: React.ReactNode) => <span className="text-[#d65a4a]">{chunks}</span>;
  const asOf = snapshot.meta.vacancies_date ?? snapshot.meta.generated_at.slice(0, 10);
  const fresh90 = snapshot.meta.posted_within_90d_pct;

  return (
    <main className="overflow-x-clip bg-[#fdf8ee] pb-28 text-[#17202a] font-[family-name:var(--font-spark-body)]">
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="mx-auto w-full max-w-6xl px-6 pt-6">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Wordmark />
          </Link>
          {/* Desktop nav (≥ sm). The language switcher used to sit here too; it
              lives in the footer only now, matching the home landing — one
              place to change language across every marketing page. */}
          <nav className="hidden items-center gap-6 text-[15px] font-bold sm:flex">
            <Link href="/" className="hover:text-[#d65a4a]">
              {t("nav.home")}
            </Link>
            <Link href="/about" className="hover:text-[#d65a4a]">
              {t("nav.about")}
            </Link>
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
            >
              {t("nav.signIn")}
            </button>
          </nav>
          {/* Mobile menu toggle (< sm) — reveals the same links + Sign In, which
              were otherwise unreachable on a phone (the desktop nav is sm:flex). */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="market-mobile-menu"
            aria-label={t("nav.menu")}
            className="rounded-lg border-[3px] border-[#17202a] bg-white p-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a] sm:hidden"
          >
            {menuOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
          </button>
        </div>
        {/* Mobile menu panel (< sm) */}
        {menuOpen ? (
          <nav
            id="market-mobile-menu"
            className="mt-4 flex flex-col items-start gap-4 rounded-2xl border-[3px] border-[#17202a] bg-white px-5 py-5 text-[15px] font-bold shadow-[6px_6px_0_#17202a] sm:hidden"
          >
            <Link href="/" onClick={() => setMenuOpen(false)} className="hover:text-[#d65a4a]">
              {t("nav.home")}
            </Link>
            <Link href="/about" onClick={() => setMenuOpen(false)} className="hover:text-[#d65a4a]">
              {t("nav.about")}
            </Link>
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
            >
              {t("nav.signIn")}
            </button>
          </nav>
        ) : null}
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-14 pt-20 text-center">
        <p className={`${HAND} text-xl text-[#526b4f]`}>{t("hero.eyebrow")}</p>
        <h1 className={`${DISPLAY} mt-2 text-5xl font-extrabold leading-[1.04] sm:text-6xl`}>
          {t.rich("hero.title", { emph: coralEmph })}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-[#42606f]">{t("hero.subtitle")}</p>
        {/* A missing freshness percentage used to fall back to `?? 0`, which
            published "0% posted in the last 90 days" — a fabricated statistic,
            not a gap. Drop the clause instead.

            `n` is passed RAW, never through fmtInt: these messages carry ICU
            plurals, and `intl-messageformat` computes `value - offset`, so a
            pre-formatted "38 553" became NaN and Czech rendered the literal
            word "NaN". ICU formats the number itself, per locale. */}
        <p className={`${HAND} mt-4 text-sm text-[#526b4f]`}>
          {fresh90 == null
            ? t("hero.updatedNoPct", { date: fmtDate(asOf), n: snapshot.meta.total_vacancies })
            : t("hero.updated", { date: fmtDate(asOf), n: snapshot.meta.total_vacancies, pct: fresh90 })}
        </p>
      </section>

      {/* ── Body (Atlas) ───────────────────────────────────────── */}
      <MarketPulseAtlas />

      {/* ── Attribution footer ─────────────────────────────────── */}
      <footer className="mx-auto mt-24 max-w-4xl px-6">
        <div className="rounded-2xl border-[3px] border-[#17202a] bg-[#dce7d0] px-6 py-6 shadow-[6px_6px_0_#17202a]">
          <p className={`${HAND} text-lg text-[#526b4f]`}>{t("footer.eyebrow")}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-[#17202a]">{t("footer.coverage")}</p>
          <p className="mt-4 text-[13px] font-bold text-[#42606f]">
            {snapshot.meta.attribution} ·{" "}
            <a href={snapshot.meta.attribution_url} target="_blank" rel="noreferrer" className="underline hover:text-[#d65a4a]">
              {t("footer.sourceLink")}
            </a>
          </p>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <Link href="/" className="text-[15px] font-bold hover:text-[#d65a4a]">
            ← {t("nav.home")}
          </Link>
          <LandingLangSwitch />
        </div>
      </footer>
    </main>
  );
}
