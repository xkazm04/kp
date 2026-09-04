"use client";

import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { DEV_CASES_GLYPH } from "@/app/_components/glyph/glyphs/devCasesGlyph";
import { BTN_PRIMARY, CARD_PAD, EYEBROW, META_LABEL, PANEL, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
// The six control IDs, in reading order. The WORDS live in
// `devcase.emptyLedger.control.<id>.{name,proves}` — recruiter-facing marketing copy
// belongs in the catalog like every other recruiter-facing string — and the list itself
// lives in DevTypes so the vocabulary guard can pin all four locales to exactly six.
import { LEDGER_CONTROL_IDS } from "./DevTypes";

/* Variant B — "The sealed ledger": a case is EVIDENCE, and the list is its ledger.
 *
 * Differs from baseline and from the atelier by arguing the trust question
 * instead of the authoring one. In an era where any take-home can be delegated
 * to a model, the value of this module is the record it keeps, so the empty
 * state reads as an unopened ledger: zero sealed submissions, and the six
 * controls that will seal the first one, drawn as a chain of evidence. */

// TRUTH CONTRACT for the six anti-delegation controls listed below, each phrased as
// what it PROVES (this copy is the product's headline claim, so it is written
// against the code, not against the pitch). The six numbered controls are the ones
// the engine actually runs — #1 hash chain (db/devcase.ts verifyDevSessionChain +
// getDevSessionIntegrity), #2 prompt capture (prompt_signals.py), #3 planted
// canaries (artifact_checks.canary_outcomes), #4 session watermark
// (db/devcase.ts devSessionWatermark), #5 mid-flight perturbation (design.py +
// process_events.py), #6 frozen naive baseline (baseline.py +
// artifact_checks.baseline_similarity). Three rules this copy must keep obeying:
//
//  - CANARIES ARE ONE OF THE SIX. An earlier version of this list omitted them and
//    substituted the paste/cadence trace, which is a real mechanism
//    (devcase-authenticity.ts) but a SEVENTH one — it is named below the list, not
//    inside it.
//  - THE WATERMARK IS NARROW. A FOREIGN mark is decisive; a merely-missing own mark
//    is "a mild note, never decisive" (db/devcase.ts SessionIntegrity). So the copy
//    sells what it settles — circulation between candidates — and nothing wider.
//    It must also never say WHERE the marker lives or how it is stamped: this
//    surface is recruiter-facing, but the claim must not read as a defeat manual.
//  - THE BASELINE IS NOT A DIFF AGAINST THE SEED. That is `seedDiff`, a different
//    mechanism. #6 compares the submission against a frozen one-shot naive-LLM
//    solve and is EXPLICITLY never a penalty (DevTypes.BaselineSimilarity).

export function CasesEmptyLedger({ onDefine }: { onDefine: () => void }) {
  const t = useTranslations("devcase.emptyLedger");
  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="shrink-0 text-center lg:w-64 lg:text-left">
          <MotionizedGlyph
            data={DEV_CASES_GLYPH.data}
            viewBox={DEV_CASES_GLYPH.viewBox}
            className={`mx-auto ${GLYPH_SIZE.lg} lg:mx-0`}
          />
          <p className={`mt-2 ${EYEBROW}`}>{t("eyebrow")}</p>
          <h3 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h3>
          <p className="mt-1 text-sm text-steel">{t("lede")}</p>
          <div className="mt-3 flex justify-center gap-2 lg:justify-start">
            <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
              <span className={STAT_LABEL}>{t("statCases")}</span>
              <span className={`${STAT_VALUE} text-ink`}>0</span>
            </div>
            <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
              <span className={STAT_LABEL}>{t("statSealed")}</span>
              <span className={`${STAT_VALUE} text-ink`}>0</span>
            </div>
          </div>
          <button type="button" onClick={onDefine} className={`${BTN_PRIMARY} mt-3 h-9 px-3 text-sm`}>
            {t("cta")}
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <h4 className={META_LABEL}>{t("controlsHeading")}</h4>
          {/* The chain: a ruled rail with a link marker per control, echoing the
              hash chain running beneath the case in the glyph. */}
          <ol className="mt-3 border-l-2 border-dashed border-stone-200 pl-4">
            {LEDGER_CONTROL_IDS.map((id) => (
              <li key={id} className="relative py-2">
                <span
                  aria-hidden
                  className="absolute -left-[1.4rem] top-3.5 h-2.5 w-2.5 rounded-sm border-2 border-stone-300 bg-white"
                />
                <p className="text-sm font-semibold text-ink">{t(`control.${id}.name`)}</p>
                <p className="text-sm text-steel">{t(`control.${id}.proves`)}</p>
              </li>
            ))}
          </ol>
          {/* The seventh mechanism, named honestly OUTSIDE the six: process
              authenticity (devcase-authenticity.ts) is a scored band, not one of the
              numbered controls — and the "held, never auto-advanced" claim is the
              real gate in devcase-run.ts (`suspectAuth`) plus the orchestrator's
              advance-only comm rule. */}
          <p className="mt-3 text-sm text-steel">{t("pasteTrace")}</p>
          <p className="mt-2 text-sm text-steel">{t("honestDarkness")}</p>
        </div>
      </div>
    </section>
  );
}
