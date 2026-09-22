"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { SKIN } from "../../stage/motion";
import type { Rect } from "../../stage/stages";
import { Bar, CodeLabel, SceneStatus, statusPicker } from "../shared";
import { CYCLE, REQS, SIBLING_MATCH_LABEL, STILL, THRESHOLD, sceneAt, type Bucket, type StatusBeat } from "./data";

/*
 * Chapter 2, variant C — THREE BUCKETS.
 *
 * Metaphor: a sorting line with a line painted across it. The claim is "this
 * candidate has the skill"; the evidence decides which of three places it
 * lands, and the middle place is the one most products do not have.
 *
 * Every required skill scores 0..1 and falls into exactly one bucket against
 * `_MATCH_THRESHOLD = 0.5` (pipeline/jobfit/matching.py):
 *
 *   matched   — best ≥ 0.5, carried with its strength so a 0.55 is never
 *               presented as a 1.0
 *   unproven  — 0 < best < 0.5, tagged with WHY: adjacency, provenance, or both
 *   missing   — best is exactly 0.0
 *
 * "Unproven" is the whole argument. A product with two buckets has to call a
 * weak signal either a match (flattering) or a gap (unfair); this one refuses
 * both and says what it actually saw. The deliberate detail underneath:
 * `_SIBLING_MATCH = 0.4` (pipeline/jobfit/taxonomy.py — the SIBLING rule lives
 * with the taxonomy that decides what "adjacent" means, not with the matcher
 * that applies the threshold) sits BELOW `_MATCH_THRESHOLD` on purpose, so a
 * merely adjacent skill can never be counted as the real thing.
 *
 * Both numbers are pinned to their source files by chapters.test.ts, which
 * imports them from `./data.ts` together with the beat table (CYCLE, STILL,
 * which beat each mark lands on) and the rows; this file is geometry and words.
 */

const BUCKET_TONE: Record<Bucket, { chip: string; bar: "moss" | "amber" | "coral" }> = {
  matched: { chip: "bg-limewash text-moss", bar: "moss" },
  unproven: { chip: "bg-stone-100 text-steel", bar: "amber" },
  missing: { chip: "bg-coral/10 text-coral", bar: "coral" },
};

// ── Geometry ────────────────────────────────────────────────────────────────
// One row per requirement; the score track spans a fixed band so the painted
// threshold is a single straight line across all of them. That line is the
// scene — it has to be one continuous mark, not seven aligned ticks.
const ROW_H = 9.5;
const ROW_GAP = 1.6;
const rowRect = (i: number): Rect => ({ x: 0, y: 2 + i * (ROW_H + ROW_GAP), w: 100, h: ROW_H });

/*
 * Column stops, in percent of the FIELD width.
 *
 * Every cell in a row is absolutely positioned against these rather than
 * flex-flowed. That is load-bearing, not fastidiousness: rows span the full
 * field, so a percent inside a row IS a percent of the field, which is the only
 * way the single painted threshold line can be guaranteed to cross every bar at
 * exactly its own 0.5. A flex row with a rem-width label ahead of the track
 * puts the bars' midpoints a few pixels off the line — and a line that is
 * almost right is worse than no line, because the whole scene is the claim that
 * one number decides the bucket.
 */
const NAME_X = 2;
const TRACK_X = 34;
const TRACK_W = 36;
const SCORE_X = 71;
const BUCKET_X = 77;
const WHY_X = 88;
const THRESHOLD_X = TRACK_X + TRACK_W * THRESHOLD; // _MATCH_THRESHOLD, via ./data.ts

const NOTE: Rect = { x: 0, y: 80, w: 100, h: 20 };

export function ScoringBuckets() {
  const t = useTranslations("about.scoring");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const s = sceneAt(phase);
  const statusAt = statusPicker({
    0: t("status.s0"),
    2: t("status.s2"),
    3: t("status.s3"),
    9: t("status.s9"),
    10: t("status.s10"),
  } satisfies Record<StatusBeat, string>);

  return (
    <div ref={ref}>
      <Field min="min-h-[30rem] sm:min-h-[34rem]">
        {/* ── The threshold, painted once across every row ──────────────── */}
        <div
          aria-hidden
          className={`absolute z-10 border-l border-dashed border-coral ${SKIN}`}
          style={{
            left: `${THRESHOLD_X}%`,
            top: "0%",
            height: `${2 + REQS.length * (ROW_H + ROW_GAP)}%`,
            opacity: s.threshold ? 1 : 0,
            transitionDuration: reduced ? "0ms" : "600ms",
          }}
        />
        <div className="absolute z-10" style={{ left: `${THRESHOLD_X}%`, top: "-0.5%" }}>
          <Part show={s.threshold} reduced={reduced} className="-translate-x-1/2 whitespace-nowrap font-mono text-meta text-coral">
            0.5
          </Part>
        </div>

        {REQS.map((r, i) => {
          const done = s.resolved[i];
          const tone = BUCKET_TONE[r.bucket];
          return (
            <Slot
              key={r.skill}
              rect={rowRect(i)}
              stage={s.rows[i]}
              reduced={reduced}
            >
              <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `${NAME_X}%`, width: `${TRACK_X - NAME_X - 2}%` }}>
                <Part show={s.names} i={i} reduced={reduced} className="block truncate text-base text-ink">
                  {r.skill}
                </Part>
              </span>

              {/* The track spans a FIXED band on every row, so the painted 0.5
                  crosses each bar at its own midpoint. A per-row normalised bar
                  would make that single line a lie. */}
              <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `${TRACK_X}%`, width: `${TRACK_W}%` }}>
                <Bar value={r.best} shown={done} reduced={reduced} tone={tone.bar} />
              </span>

              <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `${SCORE_X}%` }}>
                <Part show={done} reduced={reduced} className="nums block font-mono text-meta text-steel">
                  {r.best.toFixed(2)}
                </Part>
              </span>

              <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `${BUCKET_X}%` }}>
                <Part show={done} i={1} reduced={reduced} className={`inline-block rounded-full px-2 py-0.5 text-meta ${tone.chip}`}>
                  {t(r.bucket)}
                </Part>
              </span>

              <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `${WHY_X}%`, width: `${100 - WHY_X - 2}%` }}>
                <Part show={Boolean(r.why) && s.reasons} i={2} reduced={reduced} className="block truncate font-mono text-meta text-steel">
                  {r.why ? t(r.why) : ""}
                </Part>
              </span>
            </Slot>
          );
        })}

        {/* ── Why the middle bucket exists ──────────────────────────────── */}
        <Slot rect={NOTE} stage={s.note} reduced={reduced} className="p-4">
          <CodeLabel>{SIBLING_MATCH_LABEL}</CodeLabel>
          <Part show={s.noteBody} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("note")}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
