"use client";

// 99288c0e — the case-wide shortlist: all candidates, every channel, one ranking,
// split out of DevCaseDetail.tsx.
import { Fragment } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
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
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ClipboardList size={13} className="text-coral" /> {t("title")}
        <span className="text-coral">· {shortlist.length}</span>
      </h3>
      <ul className="mt-2 space-y-1.5">
        {shortlist.map(({ s, channel }, i, arr) => {
          const rank = s.transferScore != null ? i + 1 : null;
          const isTop = rank === 1;
          return (
            <Fragment key={s.id}>
              <SubmissionRow submission={s} rank={rank} isTop={isTop} channel={channel} onChanged={onChanged} jdText={roleJdText} />
              {isTop && arr.length > 1 ? <li aria-hidden className="border-t border-dashed border-stone-200" /> : null}
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}
