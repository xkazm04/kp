"use client";

import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { Markdown } from "@/app/_components/Markdown";
import { BTN_AFFIRM, BTN_SECONDARY, DIVIDER, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { ArrivalList } from "@/app/features/library/jds/intake/IntakeArrivalMotion";
import type { FitArtifact } from "@/app/_lib/jobseeker/types";
import { useCopyState } from "@/app/features/hiring/channels/useCopyState";
import { useFitTierLabels } from "@/app/features/shared/matchLabels";
import { EligibilityChips } from "./EligibilityChips";
import { useSheetArrival } from "./useSheetArrival";
import type { PostingDetailView } from "./postingView";

// The fit studio's PLANE: the posting in one breath (title, company, the fit facts the
// coach cites), then the FitArtifact as it stands: the verdict, the gaps with their
// severity and mitigation, the cover note (Markdown, with a copy control whose failure
// is a visible state, never a silent shrug) and the questions to ask.
//
// An empty region is an EXEMPLAR, not a skeleton (docs/design/surface-doctrine.md 1).
// The headings here are already real and already named, so what a waiting region owes
// is only its SLOT: the bracketed line saying what will land in it. Grey bars said
// "something goes here" and nothing more.
//
// The gaps ARRIVE: `useSheetArrival` diffs the rows a turn produced and `ArrivalList`
// staggers only those, so a newly-found gap cascades in while the rest stay still.

/** A named-but-unfilled region. The ANGLE BRACKETS belong to the component, never the
 *  catalog: ICU MessageFormat reads `<word>` as a tag, so a translator who kept them
 *  would break the message. Not hidden from assistive tech - the slot announces
 *  itself as a slot to a reader who cannot see it, which is the point. */
function SlotLine({ text }: { text: string }) {
  return <p className="mt-2 text-body italic text-stone-400">{`<${text}>`}</p>;
}

export function FitSheet({ posting, artifact, closed, applied, onMarkApplied }: { posting: PostingDetailView; artifact: FitArtifact | null; closed: boolean; applied: boolean; onMarkApplied(): void }) {
  const t = useTranslations("me.fit");
  const tJobs = useTranslations("me.jobs");
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
        ) : posting.blocked ? (
          // A filtered posting names its gate here too — the same chip the feed row shows —
          // so the fit conversation never opens on a posting that silently has no score.
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {posting.blocked.koKeys.map((k) => (
              <Badge key={k} tone="caution" label={tJobs(`card.filtered.${k}`)} />
            ))}
            <EligibilityChips flags={posting.blocked.eligibility} />
          </div>
        ) : null}
      </section>

      <section className={`${DIVIDER} pt-4`}>
        <p className={META_LABEL}>{t("verdict.title")}</p>
        {artifact ? <FitVerdictRow verdict={artifact.verdict} applied={applied} onMarkApplied={onMarkApplied} /> : <SlotLine text={t("slot.verdict")} />}
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
  // A gap IS its skill; how it is graded and what would close it is the fingerprint,
  // so a re-graded gap reads as changed rather than as a new arrival.
  const gapRows = (artifact?.gaps ?? []).map((g, i) => ({
    ...g,
    key: `${g.skill}-${i}`,
    id: g.skill,
    fingerprint: `${g.severity}|${g.mitigation ?? ""}`,
  }));
  const delta = useSheetArrival(gapRows);
  return (
    <>
      <section className={`${DIVIDER} pt-4`}>
        <p className={META_LABEL}>{t("gaps.title")}</p>
        {!artifact ? (
          <SlotLine text={t("slot.gap")} />
        ) : gapRows.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("gaps.none")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            <ArrivalList
              items={gapRows}
              keyOf={(g) => g.key}
              idOf={(g) => g.id}
              delta={delta}
              itemClassName={`${PANEL_SUNKEN} px-3 py-2`}
              renderItem={(g) => (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{g.skill}</span>
                    <Badge tone={g.severity === "blocking" ? "critical" : g.severity === "notable" ? "caution" : "neutral"} label={t(`severity.${g.severity}`)} />
                  </div>
                  {g.mitigation ? <p className="mt-1 text-sm text-steel">{g.mitigation}</p> : null}
                </>
              )}
            />
          </ul>
        )}
      </section>

      <section className={`${DIVIDER} pt-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={META_LABEL}>{t("coverNote.title")}</p>
          {artifact?.coverNoteMd ? (
            <>
              <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} onClick={() => copy(artifact.coverNoteMd ?? "")}>
                {copyState === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copyState === "copied" ? t("coverNote.copied") : copyState === "failed" ? t("coverNote.copyFailed") : t("coverNote.copy")}
              </button>
              {/* The outcome is announced by a SIBLING live region, never by the
                  button: aria-live on the control itself re-announces the whole
                  control every time its own label changes. */}
              <span role="status" aria-live="polite" className="sr-only">
                {copyState === "copied" ? t("coverNote.copied") : copyState === "failed" ? t("coverNote.copyFailed") : ""}
              </span>
            </>
          ) : null}
        </div>
        {artifact?.coverNoteMd ? (
          <Markdown content={artifact.coverNoteMd} className="mt-2 max-w-prose text-sm leading-6 text-ink" />
        ) : (
          <p className="mt-1 text-sm text-steel">{closed ? t("coverNote.none") : t("coverNote.pending")}</p>
        )}
      </section>

      <section className={`${DIVIDER} pt-4`}>
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
