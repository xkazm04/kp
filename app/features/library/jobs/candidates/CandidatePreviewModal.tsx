"use client";

// The second door of the modal bridge: a candidate the ranking scored for this
// role who has NO pipeline entry for it.
//
// The pipeline's CandidateModal reads an entry — its stage, its timeline, its
// decision record. None of that exists yet for someone sitting in the pool, so
// this shows only what the RANKING knows (the score and its confidence, the
// matched and missing skills with their provenance, the assumptions the engine
// had to make, and the KO reasons when it was filtered out) and offers the two
// sourcing actions that used to live on the deleted cards. File them, and the
// row's next click opens the real candidate modal.

import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ConfidenceBandBadge, ConfidenceRange } from "@/app/_components/Badge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { useConfidenceBandCopy } from "@/app/features/shared/MatchPresentation";
import { provLabel } from "@/app/features/shared/matchTypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { archetypeDisplayKey } from "../JobsTypes";
import type { CandRow } from "../JobsTypes";

export function CandidatePreviewModal({
  c,
  onClose,
  added,
  adding,
  addError,
  onAdd,
  reached,
  reaching,
  reachError,
  onReach,
}: {
  c: CandRow;
  onClose: () => void;
  added: boolean;
  adding: boolean;
  addError: string | null;
  onAdd: (c: CandRow) => void;
  reached: boolean;
  reaching: boolean;
  reachError: string | null;
  onReach: (c: CandRow) => void;
}) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  const bandCopy = useConfidenceBandCopy();
  const res = c.result;
  const prov = res.matchedSkillProvenance ?? {};
  const wasReached = reached || c.outreachSent === true;
  const filed = added || Boolean(c.inPipeline);

  return (
    <Modal
      title={c.label}
      subtitle={t("previewSubtitle")}
      onClose={onClose}
      size="lg"
      footer={
        <span className="flex flex-wrap items-center gap-2">
          {wasReached ? (
            <span className={`${CHIP_QUIET} cursor-default`}>{t("reachedOut")}</span>
          ) : (
            <button
              type="button"
              onClick={() => onReach(c)}
              disabled={reaching}
              title={reachError ?? t("reachTitle")}
              className={`${BTN_SECONDARY} h-10 cursor-pointer px-4 disabled:opacity-40`}
            >
              {reaching ? t("reaching") : reachError ? t("retry") : t("reachOut")}
            </button>
          )}
          {filed ? (
            <span className={`${CHIP_QUIET} cursor-default`}>{t("inPipeline")}</span>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(c)}
              disabled={adding}
              title={addError ?? undefined}
              className={`${BTN_PRIMARY} h-10 cursor-pointer px-4 disabled:opacity-40`}
            >
              {adding ? t("addingShort") : addError ? t("retry") : t("addPipeline")}
            </button>
          )}
        </span>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ScoreBadge score={res.total} />
          <ConfidenceRange
            low={res.confidence.low}
            high={res.confidence.high}
            drivers={res.confidence.drivers}
            copy={bandCopy}
            className="nums text-sm text-steel"
          />
          <ConfidenceBandBadge level={res.confidence.level} drivers={res.confidence.drivers} copy={bandCopy} />
          <span className={CHIP_QUIET}>{enumLabel("archetype", archetypeDisplayKey(c.archetype))}</span>
          {c.seniority ? <span className={CHIP_QUIET}>{enumLabel("seniority", c.seniority)}</span> : null}
        </div>

        <p role="status" className={`${NOTICE("info")} px-3 py-1.5 text-sm`}>
          {t("previewNotFiled")}
        </p>

        {!c.koPassed && c.koReasons.length > 0 ? (
          <p role="status" className={`${NOTICE("amber")} px-3 py-1.5 text-sm`}>
            {t("previewKo", { reasons: c.koReasons.join("; ") })}
          </p>
        ) : null}

        <div>
          <p className={META_LABEL}>{t("strengths")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(res.matchedSkills ?? []).length === 0 ? (
              <span className="text-sm text-steel">{t("noneListed")}</span>
            ) : (
              (res.matchedSkills ?? []).map((s) => {
                const pl = provLabel(prov[s] ?? "self_declared");
                return (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700"
                  >
                    {s}
                    <span className={`rounded px-1 text-meta uppercase ${pl.tone}`}>
                      {enumLabel("provenance", pl.key)}
                    </span>
                  </span>
                );
              })
            )}
          </div>
        </div>

        <div>
          <p className={META_LABEL}>{t("gaps")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(res.missingSkills ?? []).length === 0 ? (
              <span className="text-sm text-steel">{t("noneListed")}</span>
            ) : (
              (res.missingSkills ?? []).map((s) => (
                <span key={s} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">
                  {s}
                </span>
              ))
            )}
          </div>
        </div>

        {c.assumptions?.length ? (
          <p className="text-sm text-steel">
            <span className="font-semibold uppercase">{t("assumptions")}</span> {c.assumptions.join(" ")}
          </p>
        ) : null}

        {addError ? <p role="alert" className="text-sm text-red-700">{t("couldntAdd", { error: addError })}</p> : null}
        {reachError ? (
          <p role="alert" className="text-sm text-red-700">{t("couldntReach", { error: reachError })}</p>
        ) : null}
      </div>
    </Modal>
  );
}
