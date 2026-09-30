"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { reportAnchor, type ReportSection as SectionId } from "../../logic/report";

// The report's typographic parts (styles/report.css), set the way the contest's design
// report sets them: a numbered heading with an accent numeral, a figure on a card with a
// "Figure N." caption and its source, a callout with a coloured left rule, a stat card
// (big numeral, one-line label, a quiet caption), and a small status pill. Structure, not
// Markdown: every part is HTML with a class, painted by tokens in both themes.

export type Tone = "moss" | "coral" | "amber" | "steel";

/** One report section: a real heading (the index links to its id, a jump focuses it). */
export function ReportSection({ id, n, title, lede, children }: { id: SectionId; n: number; title: string; lede?: ReactNode; children: ReactNode }) {
  const anchor = reportAnchor(id);
  return (
    <section className="rp-sec" aria-labelledby={anchor}>
      <h3 id={anchor} tabIndex={-1} className="rp-h">
        <span className="rp-num">{n}</span> {title}
      </h3>
      {lede ? <p className="rp-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

/** A figure on a card, captioned "Figure N. what it shows. Source: where it came from." */
export function Figure({ n, what, source, plain = false, children }: { n: number; what: string; source?: string; plain?: boolean; children: ReactNode }) {
  const t = useTranslations("gigs.report");
  return (
    <figure className={plain ? "rp-fig is-plain" : "rp-fig"}>
      {children}
      <figcaption>
        <b>{t("figure", { n })}</b> {what}
        {source ? ` ${t("source", { source })}` : null}
      </figcaption>
    </figure>
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

/** A small status pill: its glyph comes from the tone (styles/report.css), its word from the caller. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`rp-pill is-${tone}`}>{children}</span>;
}

/** A stat card: the figure, what it counts, and a quiet caption (the reason, when absent). */
export function StatCard({ value, label, caption, tone, children }: { value: ReactNode | null; label: string; caption?: ReactNode; tone?: "coral" | "moss"; children?: ReactNode }) {
  const long = typeof value === "string" && value.length > 11;
  return (
    <div className={`rp-stat${tone ? ` is-${tone}` : ""}`}>
      <b className={`rp-stat-v${value === null ? " is-absent" : long ? " is-long" : ""}`}>{value ?? "—"}</b>
      <span className="rp-stat-l">{label}</span>
      {children}
      {caption ? <em className="rp-stat-c">{caption}</em> : null}
    </div>
  );
}

/** Scroll a report element in once the tab's panel has mounted (two frames), then focus it
 *  (a heading) or mark it (an evidence row). */
export function revealSoon(id: string, how: "focus" | "mark" = "focus", block: ScrollLogicalPosition = "start") {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
      if (how === "mark") el.classList.add("target");
      else el.focus({ preventScroll: true });
    })
  );
}
