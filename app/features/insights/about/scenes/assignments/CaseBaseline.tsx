"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bottomOf, topOf, vCurve } from "../../stage/threads";
import { Bar, CodeLabel, SceneStatus, statusPicker } from "../shared";

/*
 * Chapter 5, variant B — THE FROZEN BASELINE.
 *
 * Metaphor: two people handed the same starting materials, and only one of them
 * was steering. This is the deck's evidence register turned into a control
 * group.
 *
 * At approval the case is solved ONCE by a bare model told to simulate full
 * delegation: ask no clarifying questions, flag no oddities, take every
 * starting file at face value, fill the decision log with plausible generic
 * entries. That solution is frozen per case (`dev_cases.baseline_json`) and
 * never regenerated, so every candidate is compared against the same control.
 *
 * The comparison is delta to delta, not file to file: Jaccard over the lines
 * each side ADDED to the seed, per changed path, weighted by union size.
 * Decision-log paths are excluded so a shared template cannot inflate it.
 *
 * The number is explicitly not a penalty. At 0.85 or above the product prints
 * an interview prompt, not a deduction: probe live what the candidate added
 * beyond the bare model. A high overlap is a question, and treating it as a
 * verdict would punish people for the parts of a task that genuinely have one
 * obvious answer.
 *
 * Beats (CYCLE = 15 @ 900ms ≈ 13.5s):
 *   0 outline · 1 the seed · 2 the bare model runs · 3 it is frozen
 *   4 the candidate submits · 5-6 both deltas are taken · 7 the overlap
 *   8 the reading · 9 the refusal to penalise · 10-14 hold
 */

const CYCLE = 15;
const STILL = 10;

const OVERLAP = 0.31;
const AIM = 0.85;

// ── Geometry ────────────────────────────────────────────────────────────────
const SEED: Rect = { x: 30, y: 0, w: 40, h: 15 };
const BASELINE: Rect = { x: 0, y: 26, w: 44, h: 22 };
const SUBMISSION: Rect = { x: 56, y: 26, w: 44, h: 22 };
const DELTA_L: Rect = { x: 0, y: 54, w: 44, h: 14 };
const DELTA_R: Rect = { x: 56, y: 54, w: 44, h: 14 };
const RESULT: Rect = { x: 16, y: 76, w: 68, h: 24 };


export function CaseBaseline() {
  const t = useTranslations("about.assignments");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;
  const statusAt = statusPicker({
    0: t("status.s0"),
    2: t("status.s2"),
    3: t("status.s3"),
    4: t("status.s4"),
    5: t("status.s5"),
    7: t("status.s7"),
    8: t("status.s8", { value: OVERLAP.toFixed(2) }),
    9: t("status.s9", { aim: AIM.toFixed(2) }),
  });

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          <Wire d={vCurve(bottomOf(SEED, 0.25), topOf(BASELINE, 0.5))} drawn={at(2)} stroke={INK.quiet} reduced={reduced} />
          <Wire d={vCurve(bottomOf(SEED, 0.75), topOf(SUBMISSION, 0.5))} drawn={at(4)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(BASELINE, 0.5), topOf(DELTA_L, 0.5))} drawn={at(5)} stroke={INK.quiet} reduced={reduced} />
          <Wire d={vCurve(bottomOf(SUBMISSION, 0.5), topOf(DELTA_R, 0.5))} drawn={at(6)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(DELTA_L, 0.5), topOf(RESULT, 0.25))} drawn={at(7)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(DELTA_R, 0.5), topOf(RESULT, 0.75))} drawn={at(7)} stroke={INK.line} reduced={reduced} delay={0.08} />
        </Wires>

        <Slot rect={SEED} stage={stageOf({ shell: 1, body: 1, detail: 1, chosen: null }, phase)} reduced={reduced} className="grid place-items-center px-3">
          <div className="text-center">
            <CodeLabel>{t("seed")}</CodeLabel>
            <Part show={at(1)} reduced={reduced} className="mt-1 block text-base text-ink">
              {t("seedBody")}
            </Part>
          </div>
        </Slot>

        <Slot rect={BASELINE} stage={stageOf({ shell: 2, body: 2, detail: 3, chosen: 3 }, phase)} chosen={at(3)} reduced={reduced} className="p-3">
          <CodeLabel code="baseline_json" />
          <Part show={at(2)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            {t("baselineBody")}
          </Part>
          <Part show={at(3)} reduced={reduced} className="mt-2 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-meta text-steel">
            {t("frozen")}
          </Part>
        </Slot>

        <Slot rect={SUBMISSION} stage={stageOf({ shell: 4, body: 4, detail: 4, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>{t("submission")}</CodeLabel>
          <Part show={at(4)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            {t("submissionBody")}
          </Part>
        </Slot>

        <Slot rect={DELTA_L} stage={stageOf({ shell: 5, body: 5, detail: 5, chosen: null }, phase)} reduced={reduced} className="flex items-center px-3">
          <Part show={at(5)} reduced={reduced} className="text-base text-steel">
            {t("deltaBaseline")}
          </Part>
        </Slot>

        <Slot rect={DELTA_R} stage={stageOf({ shell: 6, body: 6, detail: 6, chosen: null }, phase)} reduced={reduced} className="flex items-center px-3">
          <Part show={at(6)} reduced={reduced} className="text-base text-steel">
            {t("deltaSubmission")}
          </Part>
        </Slot>

        <Slot rect={RESULT} stage={stageOf({ shell: 7, body: 7, detail: 8, chosen: null }, phase)} reduced={reduced} className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <CodeLabel code="baseline_similarity" />
            <Part show={at(8)} reduced={reduced} className="nums font-serif text-h2 leading-none text-ink">
              {OVERLAP.toFixed(2)}
            </Part>
          </div>
          <Bar value={OVERLAP} shown={at(8)} reduced={reduced} tone="steel" className="mt-2.5" />
          <Part show={at(9)} reduced={reduced} className="mt-3 block text-base leading-snug text-ink">
            {t("note", { aim: AIM.toFixed(2) })}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
