"use client";

import type { ReactNode } from "react";
import { reportAnchor, type ReportSection as SectionId } from "../../logic/report";

// The Summary's typographic parts (styles/report.css), set the way the contest's design
// report sets them: a block heading in the serif and a callout with a coloured left rule.
// Structure, not Markdown: every part is HTML with a class, painted by tokens in both themes.

export type Tone = "moss" | "coral" | "amber" | "steel";

/** One Summary block: a real heading (the sign-off's jump focuses it). */
export function ReportSection({ id, title, lede, children }: { id: SectionId; title: string; lede?: ReactNode; children: ReactNode }) {
  const anchor = reportAnchor(id);
  return (
    <section className="rp-sec" aria-labelledby={anchor}>
      <h3 id={anchor} tabIndex={-1} className="rp-h">
        {title}
      </h3>
      {lede ? <p className="rp-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

/** A callout: a caps label over its words, a coloured rule on the left. */
export function Callout({ tone, label, children }: { tone: Tone; label: string; children: ReactNode }) {
  return (
    <div className={`rp-callout is-${tone}`}>
      <b className="rp-callout-k">{label}</b>
      <div className="rp-callout-body">{children}</div>
    </div>
  );
}

/** Scroll a Summary heading or a margin note in once the tab's panel has mounted (two
 *  frames), then focus it. */
export function revealSoon(id: string, block: ScrollLogicalPosition = "start") {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
      el.focus({ preventScroll: true });
    })
  );
}
