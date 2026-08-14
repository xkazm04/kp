"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK, SKIN } from "../../stage/motion";
import { stageOf, type Rect, type StagePlan } from "../../stage/stages";

/*
 * Variant A — THE BUILD.
 *
 * Metaphor: a factory floor with lanes. The argument it makes is about
 * *control and concurrency* — you decide what gets built, an unticked box never
 * spawns a process, the two chains that do run go side by side, and the
 * document at the end is assembled by code rather than written by the model.
 *
 * The load-bearing detail is the third lane. "Interview case" is left unticked,
 * and its lane stays a dashed ghost for the entire loop while everything around
 * it lights up. Nothing ever explains this in copy — the reader works out from
 * the picture that an unticked step costs nothing, which is a stronger way to
 * learn it than being told.
 *
 * Beats (CYCLE = 15 @ 900ms ≈ 13.5s):
 *   0 outline · 1 checklist appears · 2 two boxes tick · 3 start, lanes open
 *   4 both chains run · 5 need-analysis reports a gap · 6 analysis done
 *   7 role design runs, salary lands · 8 must-haves land · 9 document opens
 *   10-11 headings compose · 12 ready · 13-14 hold
 *
 * `stillTick` is 13: the first beat where the checklist, both live lanes and
 * the finished document are all at their final stage. That is the frame a
 * reduced-motion reader is pinned to, and it carries the whole argument.
 */

const CYCLE = 15;
const STILL = 13;

// ── Geometry ────────────────────────────────────────────────────────────────
// Percent of the field in each axis. The connector SVG runs an unlocked
// viewBox, so a number here and a number in a path are the same place.
// Heights are budgeted against the field's FLOOR height (min-h below), because
// a percent box shrinks with the viewport while the 16px type inside it does
// not. Every box here is sized for its longest real string at the narrowest
// supported measure — the first pass was ~4pp shorter per row and every label
// in the scene truncated.
const CHECKS: Rect[] = [
  { x: 0, y: 0, w: 31.5, h: 15 },
  { x: 34.25, y: 0, w: 31.5, h: 15 },
  { x: 68.5, y: 0, w: 31.5, h: 15 },
];
const ANALYZE: Rect = { x: 0, y: 26, w: 31.5, h: 19 };
const DESIGN: Rect = { x: 0, y: 48, w: 31.5, h: 19 };
const MARKET: Rect = { x: 34.25, y: 26, w: 31.5, h: 19 };
const CASE: Rect = { x: 68.5, y: 26, w: 31.5, h: 41 };
const DOC: Rect = { x: 0, y: 72, w: 65.75, h: 28 };
const GAP: Rect = { x: 68.5, y: 72, w: 31.5, h: 28 };

// Schedules. `chosen: null` is the honest part of this scene — the case lane
// is scenery that never gets a commit beat, because it was never asked for.
const PLANS = {
  check: { shell: 1, body: 2, detail: 2, chosen: 3 } satisfies StagePlan,
  checkOff: { shell: 1, body: 2, detail: 2, chosen: null } satisfies StagePlan,
  analyze: { shell: 3, body: 4, detail: 5, chosen: 6 } satisfies StagePlan,
  design: { shell: 6, body: 7, detail: 8, chosen: 8 } satisfies StagePlan,
  market: { shell: 3, body: 4, detail: 7, chosen: 7 } satisfies StagePlan,
  case: { shell: 99, body: 99, detail: 99, chosen: null } satisfies StagePlan,
  doc: { shell: 9, body: 10, detail: 11, chosen: 12 } satisfies StagePlan,
} as const;

const CHECKLIST = [
  { label: "Job description", note: "Draft the role from your need", on: true },
  { label: "Market research", note: "A web-grounded band, with sources", on: true },
  { label: "Interview case", note: "A work sample for the shortlist", on: false },
];

const HEADINGS = ["About the role", "Responsibilities", "What you'll bring", "Nice to have", "Salary"];

const STATUS: Record<number, string> = {
  0: "jd_build · queued",
  2: "one box unticked — that step will not run",
  3: "jd_build · running · 2 chains",
  4: "analyze-need · market-salary",
  5: "reality reflection: stated stack vs. the real codebase",
  7: "role-design · market band resolved",
  9: "composeMarkdown() — assembled in code, not written",
  12: "analysis_status: ready",
};

function statusAt(phase: number): string {
  for (let p = phase; p >= 0; p--) if (STATUS[p]) return STATUS[p];
  return STATUS[0];
}

// ── Parts ───────────────────────────────────────────────────────────────────

/** A lane's human name. Uppercase tracking reads as a section marker. */
function LaneLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-meta uppercase tracking-wide text-steel">{children}</p>;
}

/**
 * A lane labelled by its real code identifier. Deliberately NOT uppercased:
 * `statedVsRealGaps` shouted as STATEDVSREALGAPS loses the camel-case that
 * makes it greppable, which is the only reason to print an identifier at all.
 */
function CodeLabel({ children }: { children: React.ReactNode }) {
  return <p className="truncate font-mono text-meta text-steel">{children}</p>;
}

export function JdBuild() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;

  const docStage = stageOf(PLANS.doc, phase);
  const headingsShown = phase >= 11 ? 5 : phase >= 10 ? 3 : 0;

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          {/* Ticked boxes hand work down into their lane. The third wire is
              dashed and never drawn: a route that exists but was not taken. */}
          <Wire d="M 15.75 15 L 15.75 26" drawn={at(3)} stroke={INK.act} reduced={reduced} />
          <Wire d="M 50 15 L 50 26" drawn={at(3)} stroke={INK.act} reduced={reduced} delay={0.06} />
          <Wire d="M 84.25 15 L 84.25 26" drawn dashed stroke={INK.quiet} reduced={reduced} />
          {/* The design chain is sequential — the analysis feeds the design. */}
          <Wire d="M 15.75 45 L 15.75 48" drawn={at(6)} stroke={INK.line} reduced={reduced} />
          {/* Both live chains converge on the document. */}
          <Wire d="M 15.75 67 L 15.75 72" drawn={at(9)} stroke={INK.line} reduced={reduced} />
          <Wire d="M 50 45 C 50 60, 34 60, 34 72" drawn={at(9)} stroke={INK.line} reduced={reduced} delay={0.08} />
        </Wires>

        {/* ── The checklist ─────────────────────────────────────────────── */}
        {CHECKLIST.map((item, i) => {
          const plan = item.on ? PLANS.check : PLANS.checkOff;
          const stage = stageOf(plan, phase);
          const ticked = item.on && at(2);
          return (
            <Slot key={item.label} rect={CHECKS[i]} stage={stage} chosen={ticked} reduced={reduced} className="p-3">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${SKIN} ${
                    ticked ? "border-coral bg-coral text-white" : "border-stone-300 bg-transparent text-transparent"
                  }`}
                >
                  <Check size={11} strokeWidth={3} aria-hidden />
                </span>
                <span className="min-w-0">
                  <Part show={stage !== "ghost"} i={i} reduced={reduced} className="block font-medium leading-snug text-ink">
                    {item.label}
                  </Part>
                  <Part show={phase >= 2} i={i} lead={0.1} reduced={reduced} className="mt-0.5 block text-meta text-steel">
                    {item.note}
                  </Part>
                </span>
              </div>
            </Slot>
          );
        })}

        {/* ── Lane A: the design chain (sequential) ─────────────────────── */}
        <Slot rect={ANALYZE} stage={stageOf(PLANS.analyze, phase)} chosen={at(6)} reduced={reduced} className="p-3">
          <LaneLabel>Pass 1 · analyze-need</LaneLabel>
          <Part show={at(4)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            Your need, read against the real codebase
          </Part>
          <Part show={at(5)} reduced={reduced} className="mt-2 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-meta text-steel">
            complexity: medium · 31k LOC
          </Part>
        </Slot>

        <Slot rect={DESIGN} stage={stageOf(PLANS.design, phase)} chosen={at(8)} reduced={reduced} className="p-3">
          <LaneLabel>Pass 2 · role-design</LaneLabel>
          <Part show={at(7)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            Requirements traced to what you stated
          </Part>
          <Part show={at(8)} reduced={reduced} className="mt-2 inline-flex rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
            6 must-haves · cap 8
          </Part>
        </Slot>

        {/* ── Lane B: market salary, running concurrently ───────────────── */}
        <Slot rect={MARKET} stage={stageOf(PLANS.market, phase)} chosen={at(7)} reduced={reduced} className="p-3">
          <LaneLabel>Pass 3 · market-salary</LaneLabel>
          <Part show={at(4)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            Starts at the same moment, on its own chain
          </Part>
          <Part show={at(7)} reduced={reduced} className="mt-2 inline-flex rounded-full bg-limewash px-2 py-0.5 text-meta text-moss">
            95–130k CZK · medium
          </Part>
        </Slot>

        {/* ── Lane C: never asked for, so never spawned ─────────────────── */}
        <Slot rect={CASE} stage={stageOf(PLANS.case, phase)} reduced={reduced} className="p-3">
          <LaneLabel>Interview case</LaneLabel>
          <p className="mt-1 text-base text-stone-400">Unticked. No process is spawned, no tokens are spent.</p>
        </Slot>

        {/* ── The document, assembled in code ───────────────────────────── */}
        <Slot rect={DOC} stage={docStage} chosen={at(12)} reduced={reduced} className="p-3">
          <div className="flex items-baseline justify-between gap-2">
            <CodeLabel>composeMarkdown()</CodeLabel>
            <Part show={at(12)} reduced={reduced} className="text-meta font-medium text-moss">
              ready
            </Part>
          </div>
          <ul className="mt-2 space-y-1">
            {HEADINGS.map((h, i) => (
              <li key={h} className="flex items-center gap-2">
                <span
                  className={`h-px flex-none rounded ${SKIN} ${i < headingsShown ? "w-3 bg-coral" : "w-3 bg-stone-200"}`}
                />
                <Part
                  show={i < headingsShown}
                  i={i}
                  reduced={reduced}
                  className="text-base text-ink"
                >
                  {h}
                </Part>
              </li>
            ))}
          </ul>
          <Part show={at(11)} reduced={reduced} className="mt-2 block text-meta text-steel">
            No band available would drop the salary line entirely — never print a zero.
          </Part>
        </Slot>

        {/* ── What the reality pass found ───────────────────────────────── */}
        <Slot rect={GAP} stage={stageOf(PLANS.analyze, phase)} reduced={reduced} className="p-3">
          <CodeLabel>statedVsRealGaps</CodeLabel>
          <Part show={at(5)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            Stated stack not evident in the codebase: <span className="font-medium text-coral">Kafka</span>
          </Part>
          <Part show={at(6)} i={1} reduced={reduced} className="mt-2 block text-meta text-steel">
            Reported to you, never silently corrected.
          </Part>
        </Slot>
      </Field>

      {/* One status line per scene, phase-mapped. It names what the machine is
          doing in its own words, so the picture carries the shape and the line
          carries the identifier a reader could go and grep for. */}
      <motion.p
        key={statusAt(phase)}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="mt-4 font-mono text-meta text-steel"
      >
        {statusAt(phase)}
      </motion.p>
    </div>
  );
}
