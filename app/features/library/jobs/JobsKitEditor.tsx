"use client";

// The interview kit editor: the open version's competencies, questions, FAQ and note,
// and the three things a recruiter does with them — save (a NEW draft version; nothing
// is rewritten in place), publish (what new interview links are minted from) and try
// (a rehearsal of the version as saved).
//
// The limits are the contract's, shown BEFORE a save could be refused: counts beside
// each list, an add that disables at its cap, a must-ask toggle that closes when the
// kit-wide budget is spent, and the blocking problems listed as they appear
// (jobsKitModel.kitDraftProblems — pinned against the server's own normalizer). What
// the server still repaired on the way in (`adjusted`) is shown after the save.
import { useId } from "react";
import { Plus } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_FAQ,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
} from "@/app/_lib/interview-kit-types";
import type { KitAdjustment } from "@/app/_lib/interview-kit-validate";
import { JobsKitCompetency } from "./JobsKitCompetency";
import { JobsKitFaq } from "./JobsKitFaq";
import {
  addCompetency,
  canAddCompetency,
  canPublishVersion,
  moveCompetency,
  mustAskCount,
  removeCompetency,
  type KitDraftProblem,
} from "./jobsKitModel";
import type { JobKitLogic } from "./jobsKitLogic";

const ADJUSTMENT_MAX: Record<KitAdjustment, number> = {
  competencies_truncated: KIT_MAX_COMPETENCIES,
  questions_truncated: KIT_MAX_QUESTIONS_PER_COMPETENCY,
  faq_truncated: KIT_MAX_FAQ,
  must_asks_demoted: KIT_MAX_MUST_ASKS,
  text_truncated: 0,
  ids_minted: 0,
};

export function JobsKitEditor({ k }: { k: JobKitLogic }) {
  const { t, draft, setDraft, baseAtOpen, dirty, check } = k;
  const mustAskHintId = useId();
  if (!draft) return null;

  const problemText = (p: KitDraftProblem): string => {
    switch (p.code) {
      case "noCompetencies":
        return t("problems.noCompetencies");
      case "titleMissing":
        return t("problems.titleMissing", { n: p.competency });
      case "weightMissing":
        return t("problems.weightMissing", { n: p.competency });
      case "budgetInvalid":
        return t("problems.budgetInvalid", { n: p.competency, max: p.max });
      case "noQuestions":
        return t("problems.noQuestions", { n: p.competency });
      case "textTooLong":
        return t("problems.textTooLong");
      case "emptyQuestionsSkipped":
        return t("problems.emptyQuestionsSkipped", { count: p.count });
      case "faqIncompleteSkipped":
        return t("problems.faqIncompleteSkipped", { count: p.count });
    }
  };

  const blocked = (check?.blocking.length ?? 0) > 0;
  const publishable = baseAtOpen !== null && canPublishVersion(baseAtOpen, k.state);
  const heading = !baseAtOpen
    ? t("editingBlank")
    : baseAtOpen.status === "published"
      ? t("editingPublished", { version: baseAtOpen.version })
      : t("editingDraft", { version: baseAtOpen.version });

  return (
    <section aria-label={t("editorAria")} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-ink">{heading}</h4>
        {dirty ? <span className={CHIP_QUIET}>{t("unsaved")}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void k.save()}
            disabled={!dirty || blocked || k.saving}
            className={`${BTN_PRIMARY} h-9 px-3 text-sm`}
          >
            {k.saving ? t("saving") : t("save")}
          </button>
          {publishable && baseAtOpen ? (
            <button
              type="button"
              onClick={() => void k.publish(baseAtOpen.id)}
              disabled={dirty || k.publishing !== null}
              title={dirty ? t("saveFirst") : undefined}
              className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
            >
              {k.publishing === baseAtOpen.id ? t("publishing") : t("publishThis", { version: baseAtOpen.version })}
            </button>
          ) : null}
          {baseAtOpen ? (
            <button
              type="button"
              onClick={() => void k.rehearse(baseAtOpen.id)}
              disabled={dirty || k.rehearsing}
              title={dirty ? t("saveFirst") : t("rehearseHint")}
              className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
            >
              {k.rehearsing ? t("trying") : t("tryThis")}
            </button>
          ) : null}
        </div>
      </div>
      {baseAtOpen?.status === "published" ? <p className="text-sm text-steel">{t("editingPublishedHint")}</p> : null}

      {k.newerArrived ? (
        <div role="status" className={`${NOTICE("info")} flex flex-wrap items-center gap-2 px-3 py-2 text-sm`}>
          <span>{t("newerArrived", { version: k.newerArrived.version })}</span>
          <button type="button" onClick={k.openLatest} className="focus-ring font-semibold underline">
            {t("openNewer")}
          </button>
        </div>
      ) : null}

      {k.adjusted && baseAtOpen ? (
        k.adjusted.length === 0 ? (
          <p role="status" className="text-sm text-moss">
            {t("savedAs", { version: baseAtOpen.version })}
          </p>
        ) : (
          <div role="status" className={`${NOTICE("amber")} px-3 py-2 text-sm`}>
            <p className="font-semibold">{t("adjustedTitle", { version: baseAtOpen.version })}</p>
            <ul className="mt-1 list-disc pl-5">
              {k.adjusted.map((a) => (
                <li key={a}>{t(`adjusted.${a}`, { max: ADJUSTMENT_MAX[a] })}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {[k.saveError, k.publishError, k.rehearseError].filter(Boolean).map((msg) => (
        <p key={msg} role="alert" className="text-sm text-coral">
          {msg}
          {msg === k.saveError && k.rejection?.competency ? ` ${t("rejectAt", { n: k.rejection.competency })}` : null}
        </p>
      ))}
      {k.rehearseLink ? (
        <p role="status" className="text-sm text-steel">
          {t("rehearseBlocked")}{" "}
          <a href={k.rehearseLink} target="_blank" rel="noopener noreferrer" className="focus-ring font-semibold text-coral underline">
            {t("rehearseOpen")}
          </a>
        </p>
      ) : null}

      {check && (check.blocking.length > 0 || check.notes.length > 0) ? (
        <ul aria-live="polite" className="space-y-0.5 text-sm">
          {check.blocking.map((p, i) => (
            <li key={`b-${i}`} className="text-coral">
              {problemText(p)}
            </li>
          ))}
          {check.notes.map((p, i) => (
            <li key={`n-${i}`} className="text-steel">
              {problemText(p)}
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-label={t("competencies")} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">{t("competencies")}</h4>
          <span className={`${META_LABEL} nums`}>
            {t("countMeta", { count: draft.competencies.length, max: KIT_MAX_COMPETENCIES })}
            {" · "}
            {t("mustAskMeta", { count: mustAskCount(draft), max: KIT_MAX_MUST_ASKS })}
          </span>
        </div>
        <p className="text-sm text-steel">{t("competenciesIntro")}</p>
        <p id={mustAskHintId} className="text-sm text-steel">
          <span className="font-semibold text-ink">{t("mustAsk")}:</span> {t("mustAskHint")}
        </p>
        <ol className="space-y-2">
          {draft.competencies.map((c, i) => (
            <JobsKitCompetency
              key={c.id}
              draft={draft}
              competency={c}
              index={i}
              onChange={setDraft}
              onMove={(delta) => setDraft(moveCompetency(draft, c.id, delta))}
              onRemove={() => setDraft(removeCompetency(draft, c.id))}
              canMoveUp={i > 0}
              canMoveDown={i < draft.competencies.length - 1}
              mustAskHintId={mustAskHintId}
              t={t}
            />
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setDraft(addCompetency(draft))}
          disabled={!canAddCompetency(draft)}
          className={`${BTN_GHOST} px-2 py-1 text-sm`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addCompetency")}
        </button>
      </section>

      <JobsKitFaq draft={draft} onChange={setDraft} t={t} />
    </section>
  );
}
