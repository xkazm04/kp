"use client";

// 99288c0e — the case-wide shortlist: all candidates, every channel, one ranking,
// split out of DevCaseDetail.tsx.
//
// challenge-r10 devcase-detail/A — the ranking is the ONE cohort ordering
// (devcase-cohort-rank.ts), re-tiered here from whatever order the parent hands in. In a
// MIXED cohort only the model-graded rows are numbered and crowned; rows scored by the
// keyless template are listed after them under their own label, unnumbered, because a
// template 85 and a graded 72 are two instruments and the old "#1" compared them.
import { Fragment } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { rankCohort } from "@/app/_lib/devcase-cohort-rank";
import { SubmissionRow } from "./DevSubmissionRow";
import type { Submission } from "./DevTypes";

export function DevCaseDetailShortlist({
  shortlist,
  roleJdText,
  onChanged,
}: {
  shortlist: { s: Submission; channel?: string }[];
  roleJdText: string;
  onChanged: () => void;
}) {
  const t = useTranslations("devcase.studio.shortlist");
  if (shortlist.length === 0) return null;
  const cohort = rankCohort(shortlist, (row) => row.s);
  const firstTemplate = cohort.template[0];
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ClipboardList size={13} className="text-coral" /> {t("title")}
        <span className="text-coral">· {shortlist.length}</span>
      </h3>
      <ul className="mt-2 space-y-1.5">
        {cohort.rows.map(({ item, rank }, i, arr) => {
          const { s, channel } = item;
          const isTop = rank === 1;
          return (
            <Fragment key={s.id}>
              {item === firstTemplate ? (
                <li className="pt-1 text-micro text-steel">{t("templateTier", { count: cohort.template.length })}</li>
              ) : null}
              <SubmissionRow submission={s} rank={rank} isTop={isTop} channel={channel} onChanged={onChanged} jdText={roleJdText} />
              {isTop && i < arr.length - 1 ? <li aria-hidden className="border-t border-dashed border-stone-200" /> : null}
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}
