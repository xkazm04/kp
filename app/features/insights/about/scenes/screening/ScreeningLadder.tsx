"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bottomOf, topOf, vCurve } from "../../stage/threads";
import { CodeLabel, SceneStatus, statusPicker } from "../shared";

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
 * Beats (CYCLE = 14 @ 900ms ≈ 12.6s):
 *   0 outline · 1 the cohort · 2 KO gates fire · 3 the KO reasons
 *   4 survivors drop to layer B · 5 scored · 6 ranked
 *   7 the top few rise to layer C · 8 the model reasons · 9 the cost line
 *   10-13 hold
 */

const CYCLE = 14;
const STILL = 10;

const COHORT = 120;
const SURVIVORS = 74;
const TOP_N = 8;

/** Real KoReasonKey values, with the clause the product actually prints. */
const KO_REASONS = [
  { key: "language", n: 19 },
  { key: "seniority", n: 14 },
  { key: "education", n: 8 },
  { key: "workMode", n: 5 },
] as const;

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
  const at = (n: number) => phase >= n;
  const statusAt = statusPicker({
    0: t("status.s0", { n: COHORT }),
    2: t("status.s2"),
    3: t("status.s3", { n: COHORT - SURVIVORS }),
    4: t("status.s4"),
    7: t("status.s7", { n: TOP_N }),
    9: t("status.s9"),
  });

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          <Wire d={vCurve(bottomOf(LAYER_A, 0.5), topOf(LAYER_B, 0.5))} drawn={at(4)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(LAYER_B, 0.5), topOf(LAYER_C, 0.5))} drawn={at(7)} stroke={INK.line} reduced={reduced} />
          {/* The rejected branch leaves sideways and stops. It is dashed and
              never "drawn", because being filtered out is not an event that
              happens to a candidate — it is the absence of one. */}
          <Wire d="M 8 17 C 8 22, 6 22, 6 78" drawn dashed stroke={INK.quiet} reduced={reduced} />
        </Wires>

        {/* ── Layer A ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_A} stage={stageOf({ shell: 1, body: 1, detail: 2, chosen: 2 }, phase)} chosen={at(2)} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="A · ko_filter()" />
            <Part show={at(1)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerA")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <p className="nums font-serif text-h2 leading-none text-ink">{COHORT}</p>
            <Part show={at(2)} reduced={reduced} className="mt-1 block rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
              {t("free")}
            </Part>
          </div>
        </Slot>

        {/* ── Layer B ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_B} stage={stageOf({ shell: 4, body: 4, detail: 5, chosen: 6 }, phase)} chosen={at(6)} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="B · score_job()" />
            <Part show={at(4)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerB")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <Part show={at(4)} reduced={reduced} className="nums block font-serif text-h2 leading-none text-ink">
              {SURVIVORS}
            </Part>
            <Part show={at(5)} reduced={reduced} className="mt-1 block rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
              {t("free")}
            </Part>
          </div>
        </Slot>

        {/* ── Layer C ───────────────────────────────────────────────────── */}
        <Slot rect={LAYER_C} stage={stageOf({ shell: 7, body: 7, detail: 8, chosen: 8 }, phase)} chosen={at(8)} reduced={reduced} className="flex items-center gap-4 px-4">
          <div className="min-w-0">
            <CodeLabel code="C · match_reasoning()" />
            <Part show={at(7)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
              {t("layerC")}
            </Part>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <Part show={at(7)} reduced={reduced} className="nums block font-serif text-h2 leading-none text-ink">
              {TOP_N}
            </Part>
            <Part show={at(8)} reduced={reduced} className="mt-1 block rounded-full bg-coral/10 px-2 py-0.5 text-meta text-coral">
              {t("paid")}
            </Part>
          </div>
        </Slot>

        {/* ── What the gates said ───────────────────────────────────────── */}
        <Slot rect={REASONS} stage={stageOf({ shell: 3, body: 3, detail: 3, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel code="KoReason[]" />
          <ul className="mt-1.5 space-y-1">
            {KO_REASONS.map((r, i) => (
              <li key={r.key} className="flex items-baseline gap-2">
                <Part show={at(3)} i={i} reduced={reduced} className="nums w-6 shrink-0 text-right font-mono text-meta text-coral">
                  {r.n}
                </Part>
                <Part show={at(3)} i={i} lead={0.05} reduced={reduced} className="min-w-0 truncate text-base text-steel">
                  {t(`ko.${r.key}`)}
                </Part>
              </li>
            ))}
          </ul>
        </Slot>

        {/* ── The point ─────────────────────────────────────────────────── */}
        <Slot rect={COST} stage={stageOf({ shell: 9, body: 9, detail: 9, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>{t("costLabel")}</CodeLabel>
          <Part show={at(9)} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("cost")}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
