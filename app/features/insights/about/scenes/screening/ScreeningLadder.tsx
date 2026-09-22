"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import type { Rect } from "../../stage/stages";
import { bottomOf, topOf, vCurve } from "../../stage/threads";
import { CodeLabel, SceneStatus, statusPicker } from "../shared";
import { COHORT, CYCLE, KO_REASONS, STILL, SURVIVORS, TOP_N, sceneAt, type StatusBeat } from "./data";

/*
 * Chapter 3, variant A — THE COST LADDER.
 *
 * Metaphor: three sieves of decreasing aperture and increasing price. The
 * evidence-first register applies here as cost discipline — the expensive
 * judgement is only ever spent on candidates cheap evidence could not already
 * settle.
 *
 * The three layers are named in the code as exactly that
 * (pipeline/jobfit/matching.py: "Three layers of increasing cost"):
 *
 *   A  ko_filter        — hard gates, deterministic, runs on everyone, free
 *   B  score_job        — weighted multi-factor scorer, deterministic, free
 *   C  match_reasoning  — the LLM, cached per candidate × job, top-N only
 *
 * The detail that earns the scene: layers A and B need no API key at all. The
 * only paid step is the last one, and it never sees a candidate who was already
 * ruled out. A reader who assumes "AI screening" means a model reading 120 CVs
 * is being shown that it read four.
 *
 * The beat table (CYCLE, STILL, which beat each mark lands on), the worked
 * example's figures and the KO reasons live in `./data.ts`, where node:test can
 * import and walk them; this file is geometry and words.
 */

// ── Geometry ────────────────────────────────────────────────────────────────
// Each layer is narrower than the one above it, so the funnel is drawn by the
// boxes themselves rather than by a decorative shape behind them.
const LAYER_A: Rect = { x: 0, y: 0, w: 100, h: 17 };
const LAYER_B: Rect = { x: 13, y: 27, w: 74, h: 17 };
const LAYER_C: Rect = { x: 30, y: 54, w: 40, h: 17 };
const REASONS: Rect = { x: 0, y: 78, w: 58, h: 22 };
const COST: Rect = { x: 62, y: 78, w: 38, h: 22 };


export function ScreeningLadder() {
  const t = useTranslations("about.screening");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const s = sceneAt(phase);
  const statusAt = statusPicker({
    0: t("status.s0", { n: COHORT }),
    2: t("status.s2"),
    3: t("status.s3", { n: COHORT - SURVIVORS }),
    4: t("status.s4"),
    7: t("status.s7", { n: TOP_N }),
    9: t("status.s9"),
  } satisfies Record<StatusBeat, string>);

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          <Wire d={vCurve(bottomOf(LAYER_A, 0.5), topOf(LAYER_B, 0.5))} drawn={s.survivors} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(LAYER_B, 0.5), topOf(LAYER_C, 0.5))} drawn={s.shortlisted} stroke={INK.line} reduced={reduced} />
          {/* The rejected branch leaves sideways and stops. It is dashed and
              never "drawn", because being filtered out is not an event that
              happens to a candidate — it is the absence of one. */}
          <Wire d="M 8 17 C 8 22, 6 22, 6 78" drawn dashed stroke={INK.quiet} reduced={reduced} />
        </Wires>

        {/* ── Layer A ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_A} stage={s.layerA} chosen={s.gated} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="A · ko_filter()" />
            <Part show={s.cohort} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerA")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <p className="nums font-serif text-h2 leading-none text-ink">{COHORT}</p>
            <Part show={s.gated} reduced={reduced} className="mt-1 block rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
              {t("free")}
            </Part>
          </div>
        </Slot>

        {/* ── Layer B ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_B} stage={s.layerB} chosen={s.ranked} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="B · score_job()" />
            <Part show={s.survivors} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerB")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <Part show={s.survivors} reduced={reduced} className="nums block font-serif text-h2 leading-none text-ink">
              {SURVIVORS}
            </Part>
            <Part show={s.scored} reduced={reduced} className="mt-1 block rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
              {t("free")}
            </Part>
          </div>
        </Slot>

        {/* ── Layer C ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_C} stage={s.layerC} chosen={s.reasoned} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="C · match_reasoning()" />
            <Part show={s.shortlisted} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerC")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <Part show={s.shortlisted} reduced={reduced} className="nums block font-serif text-h2 leading-none text-ink">
              {TOP_N}
            </Part>
            <Part show={s.reasoned} reduced={reduced} className="mt-1 block rounded-full bg-coral/10 px-2 py-0.5 text-meta text-coral">
              {t("paid")}
            </Part>
          </div>
        </Slot>

        {/* ── What the gates said ───────────────────────────────────────── */}
        <Slot rect={REASONS} stage={s.reasons} reduced={reduced} className="p-3">
          <CodeLabel code="KoReason[]" />
          <ul className="mt-1.5 space-y-1">
            {KO_REASONS.map((r, i) => (
              <li key={r.key} className="flex items-baseline gap-2">
                <Part show={s.koListed} i={i} reduced={reduced} className="nums w-6 shrink-0 text-right font-mono text-meta text-coral">
                  {r.n}
                </Part>
                <Part show={s.koListed} i={i} lead={0.05} reduced={reduced} className="min-w-0 truncate text-base text-steel">
                  {t(`ko.${r.key}`)}
                </Part>
              </li>
            ))}
          </ul>
        </Slot>

        {/* ── The point ─────────────────────────────────────────────────── */}
        <Slot rect={COST} stage={s.cost} reduced={reduced} className="p-3">
          <CodeLabel>{t("costLabel")}</CodeLabel>
          <Part show={s.costLine} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("cost")}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
      {/* The one place in the deck where a number is an example rather than a
          quote, so it says so. Cheaper than inventing a fake constant to point
          at, and honest in a way a reader can check. */}
      <p className="mt-1 text-meta text-steel">{t("figuresNote")}</p>
    </div>
  );
}
