"use client";

import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { DEV_CASES_GLYPH } from "@/app/_components/glyph/glyphs/devCasesGlyph";
import { BTN_PRIMARY, CARD_PAD, EYEBROW, META_LABEL, PANEL, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";

/* Variant B — "The sealed ledger": a case is EVIDENCE, and the list is its ledger.
 *
 * Differs from baseline and from the atelier by arguing the trust question
 * instead of the authoring one. In an era where any take-home can be delegated
 * to a model, the value of this module is the record it keeps, so the empty
 * state reads as an unopened ledger: zero sealed submissions, and the six
 * controls that will seal the first one, drawn as a chain of evidence. */

// The six anti-delegation controls, each phrased as what it PROVES. Indexed, never
// constructed during render.
//
// TRUTH CONTRACT (this copy is the product's headline claim, so it is written
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
const CONTROLS = [
  {
    name: "Tamper-evident hash chain",
    proves:
      "Every observed step is chained server-side as it happens, so a session cannot be quietly rewritten afterwards. A link that fails to recompute — or a client clock that contradicts when the server received the event — marks the whole trace untrustworthy rather than merely odd.",
  },
  {
    name: "Prompt capture",
    proves:
      "The assistant and stakeholder exchanges the candidate wrote are part of the record. Model use is graded on how they drove it — decomposition, iteration, asking it to verify itself — never on volume, and never as a penalty.",
  },
  {
    name: "Planted canaries",
    proves:
      "The starter repo carries deliberate flaws, each with one checkable truth. Every one comes back addressed, flagged, propagated or unverifiable — a planted flaw that survived into the submission is generated output that was shipped unread.",
  },
  {
    name: "Mid-flight perturbation",
    proves:
      "A requirement moves while the work is open, server-timestamped. Everything after that moment is adaptation to a brief no prepared answer anticipated; absorbing it is judgment you can watch happen.",
  },
  {
    name: "Session watermark",
    proves:
      "Each session's work carries its own reference. Another session's reference turning up inside this one is decisive evidence a solution circulated between candidates. A narrow control, deliberately: on its own, a missing marker is a note for the reviewer, never a verdict.",
  },
  {
    name: "Frozen baseline comparison",
    proves:
      "At approval the case is solved once by a bare model with nobody steering it, and that answer is frozen. Submissions are compared against it. Never a penalty — it tells you where to aim the authorship interview, not what to score.",
  },
] as const;

export function CasesEmptyLedger({ onDefine }: { onDefine: () => void }) {
  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="shrink-0 text-center lg:w-64 lg:text-left">
          <MotionizedGlyph
            data={DEV_CASES_GLYPH.data}
            viewBox={DEV_CASES_GLYPH.viewBox}
            className="mx-auto h-28 w-28 lg:mx-0"
          />
          <p className={`mt-2 ${EYEBROW}`}>Ledger open</p>
          <h3 className="mt-1 font-serif text-h2 text-ink">Nothing sealed yet</h3>
          <p className="mt-1 text-sm text-steel">
            A case does not just ask a candidate to write code. It records how the work was made, and seals that record so
            you can trust what you are reading.
          </p>
          <div className="mt-3 flex justify-center gap-2 lg:justify-start">
            <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
              <span className={STAT_LABEL}>Cases</span>
              <span className={`${STAT_VALUE} text-ink`}>0</span>
            </div>
            <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
              <span className={STAT_LABEL}>Sealed</span>
              <span className={`${STAT_VALUE} text-ink`}>0</span>
            </div>
          </div>
          <button type="button" onClick={onDefine} className={`${BTN_PRIMARY} mt-3 h-9 px-3 text-sm`}>
            Open the first case
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <h4 className={META_LABEL}>What a sealed submission will carry</h4>
          {/* The chain: a ruled rail with a link marker per control, echoing the
              hash chain running beneath the case in the glyph. */}
          <ol className="mt-3 border-l-2 border-dashed border-stone-200 pl-4">
            {CONTROLS.map((c) => (
              <li key={c.name} className="relative py-2">
                <span
                  aria-hidden
                  className="absolute -left-[1.4rem] top-3.5 h-2.5 w-2.5 rounded-sm border-2 border-stone-300 bg-white"
                />
                <p className="text-sm font-semibold text-ink">{c.name}</p>
                <p className="text-sm text-steel">{c.proves}</p>
              </li>
            ))}
          </ol>
          {/* The seventh mechanism, named honestly OUTSIDE the six: process
              authenticity (devcase-authenticity.ts) is a scored band, not one of the
              numbered controls — and the "held, never auto-advanced" claim is the
              real gate in devcase-run.ts (`suspectAuth`) plus the orchestrator's
              advance-only comm rule. */}
          <p className="mt-3 text-sm text-steel">
            Alongside them, one bulk paste with no incremental build-up reads as suspect — and a suspect submission is
            held for the live interview that verifies authorship, never auto-advanced on score.
          </p>
          <p className="mt-2 text-sm text-steel">
            Every verdict above is shown to you with its own evidence, including where a check could not run: a control
            that did not fire is never displayed as one that passed. None of it starts until a case exists — define the
            need and the engine designs the assignment these controls wrap around.
          </p>
        </div>
      </div>
    </section>
  );
}
