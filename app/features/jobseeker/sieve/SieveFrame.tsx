"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
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

// ONE SECTION, TWO STEPS. "Your CV" (2) and "You" (3) are read in the same section —
// StepYou draws the CV and the person read out of it side by side under one heading
// (#s-cv). Two rail items that lit and scrolled separately made the rail disagree with
// the page: 2 lit while the seeker read 3's half, and 3 landed where 2 did. So a step
// may name the section it lives in; the pair then lights together, links to the
// section's head (never below its heading), and is drawn as one joined card.
// The flow's scroll-spy (SieveFlow) folds a step onto its section through the same map.
const SECTION_OF: Readonly<Record<string, string>> = { you: "cv" };

/** The rail step whose section a step is read in (itself, unless it shares one). */
export function railSection(id: string): string {
  return SECTION_OF[id] ?? id;
}

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
  onStep,
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
  /** Told which step the reader just asked for, so the flow can light it at once. */
  onStep?: (id: string) => void;
  children: ReactNode;
}) {
  const t = useTranslations("me.sieve.frame");
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  useStripHeight(rootRef, railRef);
  const activeSection = active === null ? null : railSection(active);
  const anchorOf = (s: RailStep) => steps.find((x) => x.id === railSection(s.id))?.anchor ?? s.anchor;
  return (
    <div className={SV_ROOT} ref={rootRef}>
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

      <nav className="rail" aria-label={t("railLabel")} ref={railRef}>
        <ol>
          {steps.map((s, i) => {
            const on = activeSection !== null && railSection(s.id) === activeSection;
            const pairStart = i + 1 < steps.length && railSection(steps[i + 1].id) === railSection(s.id);
            const pairEnd = i > 0 && railSection(steps[i - 1].id) === railSection(s.id);
            return (
              <li
                key={s.id}
                className={cx(s.state === "gap" ? "gap" : "reached", s.state === "done" && "done", on && "active", pairStart && "pair-start", pairEnd && "pair-end")}
                data-rs={s.id}
              >
                <Link
                  className="rs"
                  href={`${hrefBase}#${anchorOf(s)}`}
                  aria-current={on ? "step" : undefined}
                  onClick={() => {
                    onStep?.(s.id);
                    // On the flow itself, land the section by hand as well. A link to the
                    // hash the URL already carries is not a navigation, so the router
                    // scrolls nothing — every second click on the joined pair, and any
                    // step clicked again after reading on — and a hash navigation that
                    // races a render could leave the page where it was. The router's own
                    // scroll, when it comes, lands on the same edge.
                    document.getElementById(anchorOf(s))?.scrollIntoView({ block: "start" });
                  }}
                >
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
            );
          })}
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
        {/* Below 860px the rail is a horizontal strip with no room for its foot, so the
            side pages and the house preferences move here — the end of the page, where
            the preference menus can open upward. Hidden on wider screens. */}
        <div className="mobile-foot">
          <Link href="/me/sources" aria-current={page === "sources" ? "page" : undefined}>
            {t("advancedSources")}
          </Link>
          <Link href="/me/scans" aria-current={page === "scans" ? "page" : undefined}>
            {t("scanHistory")}
          </Link>
          <span className="mobile-prefs">
            <RailPreferences />
          </span>
        </div>
      </main>
    </div>
  );
}

// Below 860px the rail is a sticky strip under the top bar, and its height is not a
// constant: every label and count wraps at its own width. A section jumped to must land
// BELOW the strip, so the strip's measured height is published on the root as
// `--sv-strip-h`, which the narrow layout adds to every section's scroll-margin-top
// (sieve.css). Measured always, used only where the rail is a strip.
function useStripHeight(rootRef: RefObject<HTMLDivElement | null>, railRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!root || !rail || typeof ResizeObserver === "undefined") return;
    let first = true;
    const publish = () => {
      root.style.setProperty("--sv-strip-h", `${Math.ceil(rail.getBoundingClientRect().height)}px`);
      // A deep link (/me#s-evening) scrolled on load, before the strip was measured: land
      // it again once, now that the margin is true.
      if (first) {
        first = false;
        const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
        if (target && target.classList.contains("step")) target.scrollIntoView({ block: "start" });
      }
    };
    const ro = new ResizeObserver(publish);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [rootRef, railRef]);
}
