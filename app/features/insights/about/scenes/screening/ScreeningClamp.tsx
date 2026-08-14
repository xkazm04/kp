"use client";

import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { leftOf, rightOf, sCurve } from "../../stage/threads";
import { CodeLabel, SceneStatus, statusPicker } from "../shared";

/*
 * Chapter 3, variant B — THE CLAMP.
 *
 * Metaphor: an opinion going through a valve. Chapter 1 showed a claim that
 * could not find evidence and was dropped; this shows a claim that has evidence
 * but still does not get to decide.
 *
 * The model returns `{recommendation, confidence}` — an OPINION. A deterministic
 * collapse in `screen_candidate` (pipeline/jobfit/automation.py) turns that into
 * a two-valued `route`, and the rule is unforgiving:
 *
 *     advance = recommendation == "advance"
 *               and confidence >= POLICY["screen_advance_conf"]   # 80
 *               and not early_career
 *     route = "advance" if advance else "hold"
 *
 * So an "advance" at 79 is, at the gate, indistinguishable from a "hold". And
 * the clamp only ever moves one way: a `reject` on an early-career profile is
 * rewritten to `hold`, never the reverse. The model can be more cautious than
 * the gate; it can never be less.
 *
 * Three candidates run at once so the rule reads as a rule rather than as one
 * outcome — including the one whose confidence is a single point short.
 *
 * Beats (CYCLE = 15 @ 900ms ≈ 13.5s):
 *   0 outline · 1 three candidates · 2 the model answers
 *   3 confidences land · 4 the gate is drawn · 5-7 each route resolves
 *   8 the 79 is named · 9 the shield is named · 10 the one-way note
 *   11-14 hold
 */

const CYCLE = 15;
const STILL = 11;

const CASES = [
  {
    who: "Candidate A",
    archetype: "bau",
    says: "advance",
    conf: 88,
    route: "advance",
    why: "clears 80 and is not shielded",
  },
  {
    who: "Candidate B",
    archetype: "bau",
    says: "advance",
    conf: 79,
    route: "hold",
    why: "one point short of screen_advance_conf",
  },
  {
    who: "Candidate C",
    archetype: "student",
    says: "reject",
    conf: 91,
    route: "hold",
    why: "early-career — reject is rewritten to hold",
  },
] as const;

// ── Geometry ────────────────────────────────────────────────────────────────
const ROW_H = 17;
const ROW_GAP = 4;
const opinionRect = (i: number): Rect => ({ x: 0, y: 4 + i * (ROW_H + ROW_GAP), w: 42, h: ROW_H });
const routeRect = (i: number): Rect => ({ x: 62, y: 4 + i * (ROW_H + ROW_GAP), w: 38, h: ROW_H });

/** The valve sits between the two columns, spanning all three rows. */
const GATE_X = 52;
const NOTE: Rect = { x: 0, y: 74, w: 100, h: 26 };

const resolvesAt = (i: number) => 5 + i;

const statusAt = statusPicker({
  0: "screen_candidate — the model is asked for an opinion",
  2: "{ recommendation, confidence } — an opinion, not a decision",
  4: "POLICY.screen_advance_conf = 80",
  5: "route = advance if (advance AND conf >= 80 AND not early_career) else hold",
  8: "79 is not 80 — at the gate it is indistinguishable from a hold",
  9: "an early-career reject is rewritten to hold, never the reverse",
});

export function ScreeningClamp() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          {CASES.map((c, i) => (
            <Wire
              key={c.who}
              d={sCurve(rightOf(opinionRect(i)), leftOf(routeRect(i)), 0.5)}
              drawn={at(resolvesAt(i))}
              stroke={c.route === "advance" ? INK.good : INK.act}
              width={0.45}
              reduced={reduced}
            />
          ))}
        </Wires>

        {/* ── The valve ─────────────────────────────────────────────────── */}
        <div
          aria-hidden
          className="absolute z-10 border-l-2 border-dashed border-steel"
          style={{
            left: `${GATE_X}%`,
            top: "2%",
            height: `${2 + CASES.length * (ROW_H + ROW_GAP)}%`,
            opacity: at(4) ? 1 : 0,
            transition: reduced ? "none" : "opacity 500ms ease-out",
          }}
        />
        <div className="absolute z-10 -translate-x-1/2" style={{ left: `${GATE_X}%`, top: "0%" }}>
          <Part show={at(4)} reduced={reduced} className="whitespace-nowrap rounded-full bg-stone-100 px-2 py-0.5 font-mono text-meta text-steel">
            the gate
          </Part>
        </div>

        {/* ── What the model said ───────────────────────────────────────── */}
        {CASES.map((c, i) => (
          <Slot
            key={c.who}
            rect={opinionRect(i)}
            stage={stageOf({ shell: 1, body: 2, detail: 3, chosen: null }, phase)}
            reduced={reduced}
            className="p-3"
          >
            <div className="flex items-baseline gap-2">
              <Part show={at(1)} i={i} reduced={reduced} className="truncate font-medium text-ink">
                {c.who}
              </Part>
              <Part show={at(1)} i={i} lead={0.06} reduced={reduced} className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-meta text-steel">
                {c.archetype}
              </Part>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <Part show={at(2)} i={i} reduced={reduced} className="font-mono text-meta text-steel">
                recommendation
              </Part>
              <Part show={at(2)} i={i} lead={0.06} reduced={reduced} className="font-medium text-ink">
                {c.says}
              </Part>
              <Part show={at(3)} i={i} reduced={reduced} className="ml-auto nums font-mono text-meta text-steel">
                conf {c.conf}
              </Part>
            </div>
          </Slot>
        ))}

        {/* ── What the gate did with it ─────────────────────────────────── */}
        {CASES.map((c, i) => {
          const done = at(resolvesAt(i));
          const advanced = c.route === "advance";
          return (
            <Slot
              key={c.who}
              rect={routeRect(i)}
              stage={stageOf({ shell: 4, body: resolvesAt(i), detail: resolvesAt(i), chosen: null }, phase)}
              chosen={done && advanced}
              reduced={reduced}
              className="p-3"
            >
              <CodeLabel>route</CodeLabel>
              <Part
                show={done}
                reduced={reduced}
                className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 font-medium ${
                  advanced ? "bg-limewash text-moss" : "bg-stone-100 text-steel"
                }`}
              >
                {c.route}
              </Part>
              <Part show={at(8) && i === 1} reduced={reduced} className="mt-2 block text-meta leading-snug text-steel">
                {c.why}
              </Part>
              <Part show={at(9) && i === 2} reduced={reduced} className="mt-2 block text-meta leading-snug text-steel">
                {c.why}
              </Part>
              <Part show={at(5) && i === 0} reduced={reduced} className="mt-2 block text-meta leading-snug text-steel">
                {c.why}
              </Part>
            </Slot>
          );
        })}

        {/* ── The rule, stated once ─────────────────────────────────────── */}
        <Slot rect={NOTE} stage={stageOf({ shell: 10, body: 10, detail: 10, chosen: null }, phase)} reduced={reduced} className="p-4">
          <CodeLabel>the clamp only tightens</CodeLabel>
          <Part show={at(10)} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            The model can be more cautious than the gate; it can never be less. There is no path in the code where a
            confident model turns a hold into an advance, or an early-career hold into a rejection.
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
