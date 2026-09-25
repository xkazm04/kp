"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RailPreferences } from "@/app/features/shell/nav/NavRailPreferences";
import { SieveMark } from "./marks";
import { cx, SV_ROOT } from "./sieveRecipes";
import "./sieve.css";

// The /me shell: the Sieve's top bar and its step rail, shared by the flow itself and
// the two pages that sit beside it (custom boards and rules, scan history).
//
// The rail is the flow's WAYFINDING, not a menu of pages: every step is a numbered stop
// on one line, with its live count under the label and a bar that narrows as the sieve
// works (found → through → worth your evening → decided). A step the seeker has not
// reached yet is a dashed gap in place — "not reached" and "nothing there" never render
// alike. The steps are same-document anchors on the flow (`#s-want`) and full links
// from the side pages (`/me#s-want`).
//
// The house preferences (appearance, language) sit in the rail's foot: they are the
// same RailPreferences islands the recruiter rail carries, so both themes and all four
// locales stay one click away from every /me surface.

export type RailStep = {
  id: string;
  anchor: string;
  label: string;
  count: string;
  state: "gap" | "reached" | "done";
  bar?: { tone: "b-pass" | "b-worth" | "b-dec"; value: number } | null;
  /** An unreached step keeps an empty dashed bar, so the funnel shows where it will narrow. */
  emptyBar?: boolean;
};

export function SieveFrame({
  who,
  tally,
  steps,
  active,
  note,
  hrefBase = "",
  page,
  children,
}: {
  who: { name: string; initials: string } | null;
  tally: ReactNode;
  steps: RailStep[];
  active: string | null;
  note?: ReactNode;
  /** "" on the flow (anchors stay in the document), "/me" from a side page. */
  hrefBase?: string;
  /** The side page being shown, for its rail link's aria-current. */
  page?: "sources" | "scans";
  children: ReactNode;
}) {
  const t = useTranslations("me.sieve.frame");
  return (
    <div className={SV_ROOT}>
      <a className="skip" href="#sv-main">
        {t("skip")}
      </a>
      <header className="topbar">
        <Link className="brand" href={`${hrefBase}#s-arrive`} aria-label={t("brandLabel")}>
          <SieveMark />
          <span className="brand-name">{t("brand")}</span>
        </Link>
        {who ? (
          <span className="who">
            <span className="av" aria-hidden>
              {who.initials}
            </span>
            <span>{t.rich("who", { name: who.name, b: (chunks) => <b>{chunks}</b> })}</span>
          </span>
        ) : null}
        <span className="top-tally" aria-live="polite">
          {tally}
        </span>
      </header>

      <nav className="rail" aria-label={t("railLabel")}>
        <ol>
          {steps.map((s, i) => (
            <li key={s.id} className={cx(s.state === "gap" ? "gap" : "reached", s.state === "done" && "done", active === s.id && "active")} data-rs={s.id}>
              <Link className="rs" href={`${hrefBase}#${s.anchor}`} aria-current={active === s.id ? "step" : undefined}>
                <span className="num">{i + 1}</span>
                <span className="lbl">{s.label}</span>
                <span className="cnt">{s.count}</span>
                {s.bar ? (
                  <span className={cx("bar", s.bar.tone)}>
                    <i style={{ width: `${Math.max(1.5, Math.min(100, s.bar.value * 100)).toFixed(1)}%` }} />
                  </span>
                ) : s.emptyBar ? (
                  <span className="bar gapbar" />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
        {note ? <div className="rail-note">{note}</div> : null}
        <div className="rail-links">
          <Link href="/me/sources" aria-current={page === "sources" ? "page" : undefined}>
            {t("advancedSources")}
          </Link>
          <Link href="/me/scans" aria-current={page === "scans" ? "page" : undefined}>
            {t("scanHistory")}
          </Link>
        </div>
        <div className="rail-foot">
          <RailPreferences />
        </div>
      </nav>

      <main className="main" id="sv-main">
        {children}
      </main>
    </div>
  );
}
