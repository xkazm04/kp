"use client";

import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { Markdown } from "@/app/_components/Markdown";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_AFFIRM, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import type { FitArtifact } from "@/app/_lib/jobseeker/types";
import { useCopyState } from "@/app/features/hiring/channels/useCopyState";
import { useFitTierLabels } from "@/app/features/shared/matchLabels";
import { EligibilityChips } from "./EligibilityChips";
import type { PostingDetailView } from "./postingView";

// The fit studio's PLANE: the posting in one breath (title, company, the fit facts the
// coach cites), then the FitArtifact as it stands: the verdict, the gaps with their
// severity and mitigation, the cover note (Markdown, with a copy control whose failure
// is a visible state, never a silent shrug) and the questions to ask. An empty region
// shows the SHAPE of what will fill it (studioZones.ts doctrine).

export function FitSheet({ posting, artifact, closed, applied, onMarkApplied }: { posting: PostingDetailView; artifact: FitArtifact | null; closed: boolean; applied: boolean; onMarkApplied(): void }) {
  const t = useTranslations("me.fit");
  const tierLabels = useFitTierLabels();
  return (
    <div className="space-y-6 pb-2">
      <section>
        <p className="font-serif text-h3 text-ink">{posting.title}</p>
        {posting.company ? <p className="text-sm text-steel">{[posting.company, posting.location].filter(Boolean).join(" · ")}</p> : null}
        {posting.match ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="nums text-sm font-semibold text-ink">{Math.round(posting.match.total)}</span>
            <FitTierBadge tier={posting.match.fitTier} labels={tierLabels} />
            <EligibilityChips flags={posting.match.eligibility} />
          </div>
        ) : null}
      </section>

      <section className="border-t border-stone-200 pt-4">
        <p className={META_LABEL}>{t("verdict.title")}</p>
        {artifact ? <FitVerdictRow verdict={artifact.verdict} applied={applied} onMarkApplied={onMarkApplied} /> : <Skeleton className="mt-2 h-5 w-24" />}
      </section>

      <FitArtifactSections artifact={artifact} closed={closed} />
    </div>
  );
}

/** The verdict word, and the applied door it opens: a settled `apply` is the one verdict
 *  with a next step, and it is offered wherever the verdict is shown. */
export function FitVerdictRow({ verdict, applied, onMarkApplied }: { verdict: FitArtifact["verdict"]; applied: boolean; onMarkApplied(): void }) {
  const t = useTranslations("me.fit");
  const tone = verdict === "apply" ? "positive" : verdict === "skip" ? "caution" : "neutral";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Badge tone={tone} label={t(`verdict.${verdict}`)} />
      {verdict === "apply" && !applied ? (
        <button type="button" className={`${BTN_AFFIRM} h-8 px-3 text-sm`} onClick={onMarkApplied}>
          {t("markApplied")}
        </button>
      ) : null}
      {applied ? <Badge tone="positive" label={t("appliedAlready")} /> : null}
    </div>
  );
}

// The artifact's own three regions, extracted because the posting page shows the SAME
// verdict outside the overlay (PostingDetail): the studio is where a verdict is reached,
// not where it has to be kept. `artifact === null` is the studio's pending state — the
// detail page renders this only once there is something to render.
export function FitArtifactSections({ artifact, closed }: { artifact: FitArtifact | null; closed: boolean }) {
  const t = useTranslations("me.fit");
  const { state: copyState, copy } = useCopyState();
  return (
    <>
      <section className="border-t border-stone-200 pt-4">
        <p className={META_LABEL}>{t("gaps.title")}</p>
        {!artifact ? (
          <div className="mt-2 space-y-2" aria-label={t("sheetEmpty")} role="img">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : artifact.gaps.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("gaps.none")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {artifact.gaps.map((g, i) => (
              <li key={`${g.skill}-${i}`} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{g.skill}</span>
                  <Badge tone={g.severity === "blocking" ? "critical" : g.severity === "notable" ? "caution" : "neutral"} label={t(`severity.${g.severity}`)} />
                </div>
                {g.mitigation ? <p className="mt-1 text-sm text-steel">{g.mitigation}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-stone-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={META_LABEL}>{t("coverNote.title")}</p>
          {artifact?.coverNoteMd ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} onClick={() => copy(artifact.coverNoteMd ?? "")} aria-live="polite">
              {copyState === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copyState === "copied" ? t("coverNote.copied") : copyState === "failed" ? t("coverNote.copyFailed") : t("coverNote.copy")}
            </button>
          ) : null}
        </div>
        {artifact?.coverNoteMd ? (
          <Markdown content={artifact.coverNoteMd} className="mt-2 text-sm leading-6 text-ink" />
        ) : (
          <p className="mt-1 text-sm text-steel">{closed ? t("coverNote.none") : t("coverNote.pending")}</p>
        )}
      </section>

      <section className="border-t border-stone-200 pt-4">
        <p className={META_LABEL}>{t("questions.title")}</p>
        {artifact && artifact.questionsToAsk.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink">
            {artifact.questionsToAsk.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-steel">{t("questions.none")}</p>
        )}
      </section>
    </>
  );
}
