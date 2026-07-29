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

// Six anti-delegation controls, each phrased as what it PROVES. Indexed, never
// constructed during render.
const CONTROLS = [
  {
    name: "Hash chain",
    proves: "Every recorded step links to the one before it, so a session cannot be quietly rewritten after submission.",
  },
  {
    name: "Prompt capture",
    proves: "The prompts the candidate wrote are part of the record — model use is measured, not forbidden.",
  },
  {
    name: "Paste + cadence trace",
    proves: "One bulk paste with no incremental build-up scores as suspect and is held for a live check, never auto-advanced.",
  },
  {
    name: "Mid-flight perturbation",
    proves: "A requirement moves while the work is open. Absorbing that change is judgment; a delegated answer stalls.",
  },
  {
    name: "Repository watermark",
    proves: "The seeded codebase carries a marker, so a recycled or leaked solution is identifiable on arrival.",
  },
  {
    name: "Baseline diff",
    proves: "The submission is compared against the starting snapshot, so only work that is genuinely new gets graded.",
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
          <p className="mt-3 text-sm text-steel">
            None of it fires until a case exists. Define the need and the engine designs the assignment these controls
            wrap around.
          </p>
        </div>
      </div>
    </section>
  );
}
