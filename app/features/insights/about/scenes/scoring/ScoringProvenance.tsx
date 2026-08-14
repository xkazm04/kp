"use client";

import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bowFor, leftOf, rightOf, sCurve } from "../../stage/threads";
import { Bar, CodeLabel, LaneLabel, SceneStatus, statusPicker } from "../shared";

/*
 * Chapter 2, variant B — PROVENANCE.
 *
 * Metaphor: a receipt behind every claim. This is chapter 1's argument applied
 * to a person instead of a role — a skill written on a CV is a claim, and what
 * it is worth depends entirely on the evidence behind it.
 *
 * The mechanism is real and unusually legible: every skill match is scored as
 * `taxonomy_match × provenance_weight` (`PROVENANCE_WEIGHTS` in
 * pipeline/jobfit/taxonomy.py). Five skills that look identical on the page —
 * same font, same line, same confidence — resolve to five different
 * contributions once their provenance lands.
 *
 * The beat that matters is the last one. `DEFAULT_PROVENANCE = "self_declared"`
 * (0.4) is applied to EVERYONE, not only to juniors. That was a deliberate
 * change: discounting unevidenced claims only for early-career candidates
 * penalised exactly the people least able to evidence anything. Saying so
 * out loud is the honest half of the mechanism.
 *
 * Beats (CYCLE = 14 @ 900ms ≈ 12.6s):
 *   0 outline · 1 five claims, indistinguishable · 2 the ladder appears
 *   3-7 one claim resolves to its provenance per beat · 8 contributions diverge
 *   9 the shared default lands · 10-13 hold
 */

const CYCLE = 14;
const STILL = 10;

/** Weights quoted from PROVENANCE_WEIGHTS; `taxonomy` is the hierarchy credit. */
const CLAIMS = [
  { skill: "Kubernetes", provenance: "observed", weight: 1.0, taxonomy: 1.0 },
  { skill: "PostgreSQL", provenance: "professional", weight: 1.0, taxonomy: 0.9 },
  { skill: "Terraform", provenance: "open_source", weight: 0.85, taxonomy: 1.0 },
  { skill: "Go", provenance: "personal_project", weight: 0.7, taxonomy: 1.0 },
  { skill: "Kafka", provenance: "self_declared", weight: 0.4, taxonomy: 1.0 },
] as const;

const contribution = (i: number) => CLAIMS[i].taxonomy * CLAIMS[i].weight;

// ── Geometry ────────────────────────────────────────────────────────────────
const ROW_H = 12.5;
const ROW_GAP = 2.5;
const claimRect = (i: number): Rect => ({ x: 0, y: 2 + i * (ROW_H + ROW_GAP), w: 30, h: ROW_H });
const resultRect = (i: number): Rect => ({ x: 46, y: 2 + i * (ROW_H + ROW_GAP), w: 54, h: ROW_H });

const NOTE: Rect = { x: 0, y: 82, w: 100, h: 18 };

const resolvesAt = (i: number) => 3 + i;

type Tone = "moss" | "amber" | "coral";
const TONE = (w: number): Tone => (w >= 0.85 ? "moss" : w >= 0.6 ? "amber" : "coral");

const statusAt = statusPicker({
  0: "detected_skills — five claims from one CV",
  1: "on the page these are indistinguishable",
  2: "PROVENANCE_WEIGHTS · observed 1.0 → self_declared 0.4",
  3: "score = taxonomy_match × provenance_weight",
  8: "same words, different evidence, different contribution",
  9: "DEFAULT_PROVENANCE = self_declared — applied to everyone",
});

export function ScoringProvenance() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          {CLAIMS.map((c, i) => (
            <Wire
              key={c.skill}
              d={sCurve(rightOf(claimRect(i)), leftOf(resultRect(i)), bowFor(i))}
              drawn={at(resolvesAt(i))}
              stroke={c.weight >= 0.85 ? INK.good : c.weight >= 0.6 ? INK.line : INK.act}
              width={0.4}
              reduced={reduced}
            />
          ))}
        </Wires>

        {/* ── The claims, as written ────────────────────────────────────── */}
        {CLAIMS.map((c, i) => (
          <Slot
            key={c.skill}
            rect={claimRect(i)}
            stage={stageOf({ shell: 1, body: 1, detail: 1, chosen: null }, phase)}
            reduced={reduced}
            className="flex items-center px-3"
          >
            <Part show={at(1)} i={i} reduced={reduced} className="truncate text-base text-ink">
              {c.skill}
            </Part>
          </Slot>
        ))}

        {/* ── What the evidence makes them worth ────────────────────────── */}
        {CLAIMS.map((c, i) => {
          const done = at(resolvesAt(i));
          return (
            <Slot
              key={c.skill}
              rect={resultRect(i)}
              stage={stageOf({ shell: 2, body: 2, detail: resolvesAt(i), chosen: null }, phase)}
              reduced={reduced}
              className="px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Part
                  show={done}
                  reduced={reduced}
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-meta ${
                    c.weight >= 0.85 ? "bg-limewash text-moss" : c.weight >= 0.6 ? "bg-stone-100 text-steel" : "bg-coral/10 text-coral"
                  }`}
                >
                  {c.provenance}
                </Part>
                <Part show={done} i={1} reduced={reduced} className="shrink-0 font-mono text-meta text-steel">
                  ×{c.weight.toFixed(2)}
                </Part>
                <Part show={done} i={2} reduced={reduced} className="ml-auto shrink-0 nums font-medium text-ink">
                  {contribution(i).toFixed(2)}
                </Part>
              </div>
              <Bar value={contribution(i)} shown={done} reduced={reduced} tone={TONE(c.weight)} className="mt-2" />
            </Slot>
          );
        })}

        {/* ── The honest half ───────────────────────────────────────────── */}
        <Slot rect={NOTE} stage={stageOf({ shell: 9, body: 9, detail: 9, chosen: null }, phase)} reduced={reduced} className="p-4">
          <CodeLabel>DEFAULT_PROVENANCE = &quot;self_declared&quot;</CodeLabel>
          <Part show={at(9)} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            An unevidenced claim is discounted for <span className="font-medium">every</span> candidate, not only for
            juniors — discounting it only for early-career profiles penalised exactly the people least able to evidence
            anything.
          </Part>
        </Slot>

        <div className="absolute left-0 top-[78%] w-[30%]">
          <Part show={at(2)} reduced={reduced} className="block">
            <LaneLabel>Claimed</LaneLabel>
          </Part>
        </div>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
