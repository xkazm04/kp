"use client";

import { useTranslations } from "next-intl";
import { REPORT_SECTIONS, reportAnchor, type ReportSection } from "../../logic/report";
import { jumpTo } from "../panels/BriefLinks";

// The report's index: every section numbered, in order. An open section is a link that
// scrolls its heading in and moves focus onto it (with a one-line note of what is in it); a
// section whose time has not come is a greyed line that says when it appears - never an
// empty box further down. `compact` is the sticky rail a wide proof column shows beside the
// report (numbers and titles only).

export function ReportIndex({ open, notes, compact = false }: { open: Record<ReportSection, boolean>; notes: Partial<Record<ReportSection, string>>; compact?: boolean }) {
  const t = useTranslations("gigs.report");
  return (
    <nav className={compact ? "rp-rail" : "rp-index"} aria-label={compact ? t("index.railLabel") : t("index.label")}>
      <p className="rp-kicker">{t("index.title")}</p>
      <ol>
        {REPORT_SECTIONS.map((s, i) => {
          const title = t(`sec.${s}`);
          if (!open[s]) {
            return (
              <li key={s} className="is-closed">
                <span className="rp-ix-n">{i + 1}</span>
                <span className="rp-ix-t">
                  {title}
                  {compact ? null : <span className="rp-ix-why"> · {t(`pending.${s as Exclude<ReportSection, "gig" | "plans">}`)}</span>}
                </span>
              </li>
            );
          }
          return (
            <li key={s}>
              <a href={`#${reportAnchor(s)}`} onClick={(e) => jumpTo(e, reportAnchor(s))}>
                <span className="rp-ix-n">{i + 1}</span>
                <span className="rp-ix-t">{title}</span>
              </a>
              {!compact && notes[s] ? <span className="rp-ix-note">{notes[s]}</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
