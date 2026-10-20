"use client";

import { useTranslations } from "next-intl";
import { Mark, Tag } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import type { ReviewNote } from "../../logic/reviewNote";
import type { AfterWrite } from "../../logic/wire";
import { OutreachCard } from "./OutreachCard";
import { Panel } from "./Panel";

// The Review tab in two halves (stacked when the proof column is narrow): LEFT the
// reviewer's note set out - who wrote it and the verdict, the lead as a callout, the
// must-dos above the defects, and the checks it ran in a fold; RIGHT the message to the
// client, ready to copy (OutreachCard.tsx).

export function ReviewPanel({ gig, note, onChanged }: { gig: Gig; note: ReviewNote | null; onChanged: AfterWrite }) {
  return (
    <div className="review-halves">
      <PreSendReview note={note} />
      <OutreachCard gig={gig} onChanged={onChanged} />
    </div>
  );
}

function PreSendReview({ note }: { note: ReviewNote | null }) {
  const t = useTranslations("gigs");
  if (!note) {
    return (
      <Panel title={t("back.review")}>
        <p className="panel-empty">{t("back.noReview")}</p>
      </Panel>
    );
  }
  const by = note.header ? (note.byAgent ? (note.cycle ? t("back.byAgentCycle", { cycle: note.cycle }) : t("back.byAgent")) : t("back.byReviewer")) : t("back.yourNote");
  const verdict =
    note.verdict === "blocker" ? (
      <span className="verdict-pill is-blocker">
        <Mark kind="fail" /> {t("slip.reviewBlockers", { count: note.blockers })}
      </span>
    ) : note.verdict === "warnings" ? (
      <span className="verdict-pill is-warn">
        <Mark kind="caution" /> {t("back.warningsYouDecide")}
      </span>
    ) : (
      <span className="verdict-pill">{t("back.noteWord")}</span>
    );
  return (
    <Panel title={t("back.review")} sub={<Tag label={by} />} actions={verdict}>
      {note.lead ? <p className="callout">{note.lead}</p> : null}
      <div className="review-grid">
        {note.items.length ? (
          <section>
            <h4 className="sub-title">
              {t("tabs.mustDo")} <span className="sub-n">{note.items.length}</span>
            </h4>
            <ol className="steps">
              {note.items.map((x, i) => (
                <li key={i}>
                  <span className="step-n" aria-hidden>
                    {i + 1}
                  </span>
                  <span>{x}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {note.defects.length ? (
          <section>
            <h4 className="sub-title">
              {t("tabs.defects")} <span className="sub-n">{note.defects.length}</span>
            </h4>
            <ul className="defects">
              {note.defects.map((d, i) => (
                <li key={i} className={d.blocker ? "is-blocker" : undefined}>
                  <Mark kind={d.blocker ? "fail" : "caution"} tip={d.blocker ? t("slip.blockerWord") : t("tabs.defect")} />
                  <span>
                    {d.blocker ? <b>{t("slip.blockerWord")} </b> : null}
                    {d.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {note.checks.length ? (
        <details className="checks">
          <summary>{t("back.checks", { count: note.checks.length })}</summary>
          <ol>
            {note.checks.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </Panel>
  );
}
