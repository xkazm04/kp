"use client";

import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import type { GigGoalStatus } from "@/app/_lib/gigs/types";
import type { MilestoneRow } from "../../logic/pairing";

// The accepted plan as the gig's Personas milestone (PairingPanel.tsx and the report's
// progress section): the whole as one bar, then every step as a goal - its state as a mark
// AND a word, its progress as a bar and a numeral, what "done" means, and the agent's note
// when it left one.

const GOAL: Readonly<Record<GigGoalStatus, { mark: "unknown" | "wait" | "caution" | "ok"; key: "open" | "inProgress" | "blocked" | "done" }>> = {
  open: { mark: "unknown", key: "open" },
  "in-progress": { mark: "wait", key: "inProgress" },
  blocked: { mark: "caution", key: "blocked" },
  done: { mark: "ok", key: "done" },
};

/** `whole: false` leaves the whole-milestone bar and its line to the caller (the report sets
 *  them as a stat card, report/ReportProgress.tsx). */
export function MilestoneList({ rows, pct, updated, localOnly, whole = true }: { rows: readonly MilestoneRow[]; pct: number; updated: string | null; localOnly: boolean; whole?: boolean }) {
  const t = useTranslations("gigs.pairing");
  return (
    <div className="ms">
      {whole ? (
        <div className="ms-whole">
          <span className="ms-pct">{t("pct", { pct })}</span>
          <span className="ms-track" role="img" aria-label={t("wholeAria", { pct })}>
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
      ) : null}
      {whole && (updated || localOnly) ? <p className="route-quiet">{[updated, localOnly ? t("localOnly") : null].filter(Boolean).join(" · ")}</p> : null}
      <ol className="ms-goals">
        {rows.map((r) => {
          const g = GOAL[r.status];
          const word = t(`goal.${g.key}`);
          return (
            <li key={r.index} className={`is-${g.key}`}>
              <span className="plan-n" aria-hidden>
                {r.index + 1}
              </span>
              <div className="ms-main">
                <span className="ms-title">{r.title}</span>
                <span className="plan-done">
                  <b>{t("doneWhen")}</b> {r.doneWhen}
                </span>
                {r.note ? <span className="ms-note">{r.note}</span> : null}
              </div>
              <span className={`ms-state is-${g.key}`}>
                <Mark kind={g.mark} tip={word} />
                {word}
              </span>
              <span className="ms-bar" role="img" aria-label={t("goalAria", { title: r.title, pct: r.progress })}>
                <span className="ms-track">
                  <i style={{ width: `${r.progress}%` }} />
                </span>
                <span className="ms-num">{t("pct", { pct: r.progress })}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
