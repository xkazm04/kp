"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bowFor, leftOf, rightOf, sCurve } from "../../stage/threads";
import { Bar, CodeLabel, SceneStatus, statusPicker } from "../shared";

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
 * Beats (CYCLE = 14 @ 900ms ≈ 12.6s):
 *   0 outline · 1 signals found · 2 the board · 3-6 votes land one per beat
 *   7 the winner · 8 confidence · 9 the declaration rule
 *   10 the fallback floor · 11-13 hold
 */

const CYCLE = 14;
const STILL = 10;

/** `id` is the archetype's real slug; `key` names its catalog entry. */
const TARGETS = [
  { id: "student", key: "student" },
  { id: "bau", key: "bau" },
  { id: "career_switcher", key: "switcher" },
] as const;

/**
 * Real `detection.signals[]` entries, each with its real `scores` MAP.
 *
 * `votes` is [index into TARGETS, weight] — a rule may score more than one
 * archetype, and `substantial` does: `{"bau": 1, "career_switcher": 0.5}`. This
 * used to be a single `to`/`w` pair, which dropped that second half: the tally
 * board showed Switcher at a flat 0.0 and the status line divided 4.5 by 5.5.
 * `detect()` cannot produce either number for this signal set — with the same
 * four rules firing it totals 6.0 and returns 0.75 — so a reader who reproduced
 * the example against a real `Routing: …` banner found an agreement they could
 * not reconstruct, and a rule that appears to vote for exactly one archetype.
 * Pinned against archetypes.json by chapters.test.ts.
 */
/** One rule's vote: which TARGETS row it scores, and by how much. */
type Vote = readonly [target: number, weight: number];
/** Closed, so `t(`signals.${id}`)` stays a compile-time-checked catalog key —
 *  the same reason ChapterKey is a union rather than `string`. */
type SignalId = "enrolled" | "yreLow" | "educationDominant" | "substantial";

const SIGNALS: readonly { id: SignalId; votes: readonly Vote[] }[] = [
  { id: "enrolled", votes: [[0, 2.0]] },
  { id: "yreLow", votes: [[0, 1.5]] },
  { id: "educationDominant", votes: [[0, 1.0]] },
  { id: "substantial", votes: [[1, 1.0], [2, 0.5]] },
];

/** What each archetype ends the tally on — derived, never hand-kept, so the
 *  board and the division below can't drift from the votes drawn above. */
const SCORES = TARGETS.map((_, target) =>
  SIGNALS.reduce((n, s) => n + (s.votes.find(([to]) => to === target)?.[1] ?? 0), 0)
);
const TOTAL = SCORES.reduce((a, b) => a + b, 0);
const LEADER = Math.max(...SCORES);
// UAT RECON-06 — the winner's SHARE OF THE VOTE, which is why the scene shows the
// division rather than a bare percentage. Named `signalAgreement` everywhere it
// renders now: it is not a confidence, and it is not the measurement interval the
// Matrix calls a score range, nor a model's self-report, nor a salary read's
// evidence grade. Four quantities, four words.
//
// Computed with registry.detect's own formula — `round(scores[best] / total, 2)`
// — rather than typed as a literal, so the number on screen is the number the
// mechanism would return for the votes this scene actually draws.
const SIGNAL_AGREEMENT = Math.round((LEADER / TOTAL) * 100) / 100;

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

const votesAt = (i: number) => 3 + i;


export function ArchetypeRouter() {
  const t = useTranslations("about.archetypes");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;
  const statusAt = statusPicker({
    0: t("status.s0"),
    1: t("status.s1"),
    3: t("status.s3"),
    7: t("status.s7"),
    8: t("status.s8", { total: TOTAL, value: SIGNAL_AGREEMENT }),
    9: t("status.s9"),
    10: t("status.s10"),
  });

  // `target` rather than `t`: the translation function owns that name here.
  const tally = (target: number) =>
    SIGNALS.reduce((n, s, i) => (at(votesAt(i)) ? n + (s.votes.find(([to]) => to === target)?.[1] ?? 0) : n), 0);

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          {/* One wire per VOTE, not per signal — a rule that scores two
              archetypes has to be seen reaching both, or the board's totals
              stop adding up to the division the status line prints. */}
          {SIGNALS.flatMap((s, i) =>
            s.votes.map(([to]) => (
              <Wire
                key={`${s.id}-${to}`}
                d={sCurve(rightOf(sigRect(i)), leftOf(tgtRect(to)), bowFor(i))}
                drawn={at(votesAt(i))}
                stroke={to === 0 ? INK.good : INK.line}
                width={0.4}
                reduced={reduced}
              />
            ))
          )}
        </Wires>

        {/* ── What was found ────────────────────────────────────────────── */}
        {SIGNALS.map((s, i) => (
          <Slot
            key={s.id}
            rect={sigRect(i)}
            stage={stageOf({ shell: 1, body: 1, detail: votesAt(i), chosen: null }, phase)}
            reduced={reduced}
            className="flex items-center gap-2 px-3"
          >
            <Part show={at(1)} i={i} reduced={reduced} className="min-w-0 flex-1 text-base leading-snug text-ink">
              {t(`signals.${s.id}`)}
            </Part>
            {/* Every weight the rule casts, in TARGETS order. Numerals and a
                separator only — nothing here is prose to translate. */}
            <Part show={at(votesAt(i))} reduced={reduced} className="shrink-0 nums font-mono text-meta text-steel">
              {s.votes.map(([, w]) => `+${w.toFixed(1)}`).join(" · ")}
            </Part>
          </Slot>
        ))}

        {/* ── The tally ─────────────────────────────────────────────────── */}
        {TARGETS.map((target, i) => {
          const score = tally(i);
          const winner = at(7) && i === 0;
          return (
            <Slot
              key={target.id}
              rect={tgtRect(i)}
              stage={stageOf({ shell: 2, body: 2, detail: 3, chosen: winner ? 7 : null }, phase)}
              chosen={winner}
              reduced={reduced}
              className="p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <Part show={at(2)} i={i} reduced={reduced} className="truncate font-medium text-ink">
                  {t(`targets.${target.key}`)}
                </Part>
                <Part show={at(3)} reduced={reduced} className="shrink-0 nums font-mono text-meta text-steel">
                  {score.toFixed(1)}
                </Part>
              </div>
              {/* Normalised against the LEADER, so the bars read as shares of
                  the winning tally rather than of an arbitrary ceiling. */}
              <Bar value={score / LEADER} shown={at(3)} reduced={reduced} tone={i === 0 ? "moss" : "steel"} className="mt-2" />
              <Part show={winner && at(8)} reduced={reduced} className="mt-2 block text-meta text-steel">
                {t("confidence", { value: SIGNAL_AGREEMENT })}
              </Part>
            </Slot>
          );
        })}

        {/* ── The two rules that keep it honest ─────────────────────────── */}
        <Slot rect={NOTE} stage={stageOf({ shell: 9, body: 9, detail: 10, chosen: null }, phase)} reduced={reduced} className="p-4">
          <CodeLabel code="archetype_reasons[]" />
          <Part show={at(9)} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("declaration")}
          </Part>
          <Part show={at(10)} i={1} reduced={reduced} className="mt-2.5 block text-base leading-snug text-ink">
            {t.rich("fallback", { k: (chunks) => <span className="font-mono text-meta">{chunks}</span> })}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
