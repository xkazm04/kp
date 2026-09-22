"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import type { Rect } from "../../stage/stages";
import { bowFor, leftOf, rightOf, sCurve } from "../../stage/threads";
import { Bar, CodeLabel, SceneStatus, statusPicker } from "../shared";
import {
  CYCLE,
  LEADER,
  SIGNALS,
  SIGNAL_AGREEMENT,
  STILL,
  TARGETS,
  TOTAL,
  WINNER,
  sceneAt,
  tally,
  type StatusBeat,
} from "./data";

/*
 * Chapter 4, variant B — THE ROUTER.
 *
 * Metaphor: a tally board. This is chapter 1's evidence-to-claim thread applied
 * to a classification: each signal found in the CV votes with a stated weight,
 * and the routing decision keeps the receipts.
 *
 * The mechanism is a pure rules engine (`registry.detect`), with no model in it
 * at all. Signals from the extracted profile score the three archetypes, the
 * highest wins, and confidence is the winner's share of the total vote.
 * Everything that fired is retained in `archetype_reasons` and rendered as
 * "Routing: ..." on the analysis banner.
 *
 * Two details make it worth a scene rather than a paragraph. A candidate's own
 * self-declaration is trusted at 0.9 and is never overridden; a contradicting
 * signal only lowers the confidence and appends a reason. And the unguided
 * fallback sits at 0.4, which is BELOW `lowConfidenceThreshold` of 0.55 by
 * construction, so "we had no idea" can never be displayed as a quiet result.
 *
 * The beat table (CYCLE, STILL, which beat each mark lands on), the real
 * detection rules and the tally they add up to live in `./data.ts`, where
 * node:test imports them and chapters.test.ts pins them against
 * pipeline/jobfit/archetypes.json; this file is geometry and words.
 */

// ── Geometry ────────────────────────────────────────────────────────────────
// The signal column is wider than the tally column because it carries real
// sentences while the tally carries one word and a bar. Sized so the longest
// signal ("education is the dominant CV block") wraps to two lines rather than
// truncating: these are the product's actual reason strings, and clipping them
// would hide the thing the scene exists to show.
const SIG_H = 13;
const SIG_GAP = 2;
const sigRect = (i: number): Rect => ({ x: 0, y: 2 + i * (SIG_H + SIG_GAP), w: 46, h: SIG_H });

const TGT_H = 15;
const TGT_GAP = 4;
const tgtRect = (i: number): Rect => ({ x: 62, y: 2 + i * (TGT_H + TGT_GAP), w: 38, h: TGT_H });

const NOTE: Rect = { x: 0, y: 66, w: 100, h: 34 };


export function ArchetypeRouter() {
  const t = useTranslations("about.archetypes");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const s = sceneAt(phase);
  const statusAt = statusPicker({
    0: t("status.s0"),
    1: t("status.s1"),
    3: t("status.s3"),
    7: t("status.s7"),
    8: t("status.s8", { total: TOTAL, value: SIGNAL_AGREEMENT }),
    9: t("status.s9"),
    10: t("status.s10"),
  } satisfies Record<StatusBeat, string>);

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          {/* One wire per VOTE, not per signal — a rule that scores two
              archetypes has to be seen reaching both, or the board's totals
              stop adding up to the division the status line prints. */}
          {SIGNALS.flatMap((signal, i) =>
            signal.votes.map(([to]) => (
              <Wire
                key={`${signal.id}-${to}`}
                d={sCurve(rightOf(sigRect(i)), leftOf(tgtRect(to)), bowFor(i))}
                drawn={s.voted[i]}
                stroke={to === WINNER ? INK.good : INK.line}
                width={0.4}
                reduced={reduced}
              />
            ))
          )}
        </Wires>

        {/* ── What was found ────────────────────────────────────────────── */}
        {SIGNALS.map((signal, i) => (
          <Slot
            key={signal.id}
            rect={sigRect(i)}
            stage={s.signals[i]}
            reduced={reduced}
            className="flex items-center gap-2 px-3"
          >
            <Part show={s.signalNames} i={i} reduced={reduced} className="min-w-0 flex-1 text-base leading-snug text-ink">
              {t(`signals.${signal.id}`)}
            </Part>
            {/* Every weight the rule casts, in TARGETS order. Numerals and a
                separator only — nothing here is prose to translate. */}
            <Part show={s.voted[i]} reduced={reduced} className="shrink-0 nums font-mono text-meta text-steel">
              {signal.votes.map(([, w]) => `+${w.toFixed(1)}`).join(" · ")}
            </Part>
          </Slot>
        ))}

        {/* ── The tally ─────────────────────────────────────────────────── */}
        {TARGETS.map((target, i) => {
          const score = tally(s.voted, i);
          const winner = s.won && i === WINNER;
          return (
            <Slot
              key={target.id}
              rect={tgtRect(i)}
              stage={s.targets[i]}
              chosen={winner}
              reduced={reduced}
              className="p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <Part show={s.targetNames} i={i} reduced={reduced} className="truncate font-medium text-ink">
                  {t(`targets.${target.key}`)}
                </Part>
                <Part show={s.scored} reduced={reduced} className="shrink-0 nums font-mono text-meta text-steel">
                  {score.toFixed(1)}
                </Part>
              </div>
              {/* Normalised against the LEADER, so the bars read as shares of
                  the winning tally rather than of an arbitrary ceiling. */}
              <Bar value={score / LEADER} shown={s.scored} reduced={reduced} tone={i === WINNER ? "moss" : "steel"} className="mt-2" />
              <Part show={winner && s.agreement} reduced={reduced} className="mt-2 block text-meta text-steel">
                {t("confidence", { value: SIGNAL_AGREEMENT })}
              </Part>
            </Slot>
          );
        })}

        {/* ── The two rules that keep it honest ─────────────────────────── */}
        <Slot rect={NOTE} stage={s.note} reduced={reduced} className="p-4">
          <CodeLabel code="archetype_reasons[]" />
          <Part show={s.declaration} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("declaration")}
          </Part>
          <Part show={s.fallback} i={1} reduced={reduced} className="mt-2.5 block text-base leading-snug text-ink">
            {t.rich("fallback", { k: (chunks) => <span className="font-mono text-meta">{chunks}</span> })}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
