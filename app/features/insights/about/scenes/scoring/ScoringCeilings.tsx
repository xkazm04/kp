"use client";

import { Field, Part, Slot } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { SKIN } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { SceneStatus, statusPicker } from "../shared";

/*
 * Chapter 2, variant A — CEILINGS.
 *
 * Metaphor: five measuring jars of different sizes. The claim being examined is
 * the score itself, and the evidence is the five components it is made of.
 *
 * The argument: the total is not a judgement the model hands down, it is
 * arithmetic. Five factors have FIXED maxima that sum to exactly 100
 * (`FACTOR_MAXES` in app/_lib/factor-points.ts, mirrored from
 * `_score_from_payload` in pipeline/jobfit/pipeline.py), and the persisted
 * total is always their sum. The jars are drawn at their true relative
 * capacities before anything fills, so a reader sees that Skills can contribute
 * three times what Traits can — a fact no single number could convey.
 *
 * The payoff beat is the last one. The model also returns its own opinion of
 * the total; the product keeps that number only as a DIVERGENCE SIGNAL and
 * never lets it reach the score. Watching a plausible 78 arrive and be set
 * aside in favour of the arithmetic is the whole chapter in one gesture.
 *
 * Beats (CYCLE = 13 @ 900ms ≈ 11.7s):
 *   0 outline · 1 the five capacities · 2-6 one factor fills per beat
 *   7 total resolves to 75 · 8 the model's own claim arrives
 *   9 it is set aside as divergence · 10-12 hold
 */

const CYCLE = 13;
const STILL = 10;

/** Real maxima. They sum to 100 by construction — that is the whole point. */
const FACTORS = [
  { key: "experience", label: "Experience", max: 25, earned: 18 },
  { key: "skills", label: "Skills", max: 30, earned: 24 },
  { key: "role", label: "Role", max: 23, earned: 17 },
  { key: "education", label: "Education", max: 12, earned: 9 },
  { key: "traits", label: "Traits", max: 10, earned: 7 },
] as const;

const TOTAL = FACTORS.reduce((n, f) => n + f.earned, 0); // 75
const MODEL_CLAIM = 78;

// ── Geometry ────────────────────────────────────────────────────────────────
// Jars are bottom-anchored on a common baseline and their heights are strictly
// proportional to `max`, so the drawing itself carries the ceiling rule.
const BASE = 66; // baseline, in percent from the top
const TALLEST = 52; // height of the 30-point jar
const COL_W = 17;
const COL_GAP = 3.75;

const jarRect = (i: number): Rect => {
  const h = (FACTORS[i].max / 30) * TALLEST;
  return { x: i * (COL_W + COL_GAP), y: BASE - h, w: COL_W, h };
};

const READOUT: Rect = { x: 0, y: 74, w: 48, h: 26 };
const DIVERGENCE: Rect = { x: 52, y: 74, w: 48, h: 26 };

const fillsAt = (i: number) => 2 + i;
const runningTotal = (phase: number) =>
  FACTORS.reduce((n, f, i) => (phase >= fillsAt(i) ? n + f.earned : n), 0);

const statusAt = statusPicker({
  0: "analyses.score — five components, fixed ceilings",
  1: "experience 25 · skills 30 · role 23 · education 12 · traits 10 = 100",
  2: "each factor scored against its own maximum",
  7: `persisted total = sum of components = ${TOTAL}`,
  8: `the model also returned a total of its own: ${MODEL_CLAIM}`,
  9: "kept as a divergence signal · never used as the score",
});

export function ScoringCeilings() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;
  const total = runningTotal(phase);

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        {FACTORS.map((f, i) => {
          const filled = at(fillsAt(i));
          return (
            <div key={f.key} className="absolute" style={{ left: `${jarRect(i).x}%`, top: `${jarRect(i).y}%`, width: `${COL_W}%`, height: `${jarRect(i).h}%` }}>
              {/* The jar: a dashed capacity that is drawn BEFORE anything fills
                  it, so the ceiling reads as a property of the factor rather
                  than as however far this candidate happened to get. */}
              <div className={`relative h-full w-full rounded-lg border border-dashed border-stone-300 ${SKIN}`}>
                <div
                  className={`absolute inset-x-0 bottom-0 rounded-b-lg rounded-t-sm ${SKIN} ${filled ? "bg-moss/70" : "bg-transparent"}`}
                  style={{
                    height: filled ? `${(f.earned / f.max) * 100}%` : "0%",
                    transitionProperty: "height, background-color",
                    transitionDuration: reduced ? "0ms" : "650ms",
                  }}
                />
                <span className="absolute inset-x-0 top-1.5 text-center">
                  <Part show={at(1)} i={i} reduced={reduced} className="font-mono text-meta text-steel">
                    {f.max}
                  </Part>
                </span>
              </div>
              <p className="mt-1.5 truncate text-center text-meta text-steel">{f.label}</p>
              <p className="text-center">
                <Part show={filled} reduced={reduced} className="nums font-medium text-ink">
                  {f.earned}
                </Part>
              </p>
            </div>
          );
        })}

        {/* ── The arithmetic ───────────────────────────────────────────── */}
        <Slot rect={READOUT} stage={stageOf({ shell: 1, body: 2, detail: 7, chosen: 7 }, phase)} chosen={at(7)} reduced={reduced} className="p-4">
          <p className="font-mono text-meta text-steel">reconcileScoreTotal()</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="nums font-serif text-display leading-none text-ink">{total}</span>
            <span className="text-base text-steel">/ 100</span>
            <Part show={at(7)} reduced={reduced} className="ml-auto rounded-full bg-limewash px-2 py-0.5 text-meta font-medium text-moss">
              Strong
            </Part>
          </p>
          <Part show={at(7)} i={1} reduced={reduced} className="mt-2 block text-meta text-steel">
            Bands: Early · Developing · Solid · Strong 70–85 · Excellent
          </Part>
        </Slot>

        {/* ── The claim that carries no authority ──────────────────────── */}
        <Slot rect={DIVERGENCE} stage={stageOf({ shell: 8, body: 8, detail: 9, chosen: null }, phase)} reduced={reduced} className="p-4">
          <p className="font-mono text-meta text-steel">payload.score.total</p>
          <p className="mt-2 flex items-baseline gap-2">
            <Part show={at(8)} reduced={reduced} className={`nums font-serif text-h2 leading-none ${at(9) ? "text-stone-400 line-through" : "text-ink"}`}>
              {MODEL_CLAIM}
            </Part>
            <Part show={at(8)} i={1} reduced={reduced} className="text-base text-steel">
              — the model&rsquo;s own total
            </Part>
          </p>
          <Part show={at(9)} reduced={reduced} className="mt-2 block text-base leading-snug text-ink">
            Demoted to a sanity check. A three-point disagreement is recorded, not obeyed.
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
