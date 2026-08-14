"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK, SKIN } from "../../stage/motion";
import { stageOf, type Rect, type StagePlan } from "../../stage/stages";

/*
 * Variant C — THE INTAKE.
 *
 * Metaphor: a transcript with a spine growing beside it. Variants A and B both
 * start after the need exists; this one argues about where the need comes from
 * — a conversation, not a form — and about what the machine is allowed to claim
 * it learned.
 *
 * The load-bearing device is the provenance stamp. Every field on the right
 * carries one of three marks — `stated` (you said it), `inferred` (we deduced
 * it), `default` (nobody said, we filled it) — and the marks arrive at
 * different beats from different turns, so the reader watches the difference
 * between what was captured and what was assumed. A brief that cannot tell
 * those apart is a brief you cannot audit.
 *
 * Beats (CYCLE = 16 @ 900ms ≈ 14.4s):
 *   0 outline · 1 the opener (always deterministic) · 2 first answer
 *   3 title lands, stated · 4 follow-up · 5 seniority lands, inferred
 *   6 second answer · 7 three requirements land with weights
 *   8 role family lands, default · 9 shape triage · 10 read-back
 *   11 promote · 12-15 hold
 *
 * `stillTick` is 12 — the complete spine plus the promote handoff.
 */

const CYCLE = 16;
const STILL = 12;

// ── Geometry ────────────────────────────────────────────────────────────────
const TURNS: { rect: Rect; who: "system" | "you"; text: string; at: number }[] = [
  { rect: { x: 0, y: 2, w: 42, h: 13 }, who: "system", text: "What are you hiring for, and what makes this role hard right now?", at: 1 },
  { rect: { x: 4, y: 18, w: 38, h: 13 }, who: "you", text: "Someone to own our billing service. It keeps breaking and nobody owns it.", at: 2 },
  { rect: { x: 0, y: 34, w: 42, h: 11 }, who: "system", text: "Who would they work with, and what should be true in 90 days?", at: 4 },
  { rect: { x: 4, y: 48, w: 38, h: 15 }, who: "you", text: "Two backend devs. In 90 days billing should be boring — tests, alerts, and one person who knows it.", at: 6 },
  { rect: { x: 0, y: 66, w: 42, h: 15 }, who: "system", text: "Read-back: a senior backend engineer owning billing, with reliability as the 90-day outcome. Right?", at: 10 },
];

const FIELDS: { key: string; value: string; mark: "stated" | "inferred" | "default"; at: number }[] = [
  { key: "title", value: "Billing Engineer", mark: "stated", at: 3 },
  { key: "seniority", value: "senior", mark: "inferred", at: 5 },
  { key: "role_family", value: "software_engineering", mark: "default", at: 8 },
];

const REQS: { skill: string; weight: string; at: number }[] = [
  { skill: "Service ownership", weight: "0.8", at: 7 },
  { skill: "Testing & alerting", weight: "0.8", at: 7 },
  { skill: "Payments domain", weight: "0.4", at: 7 },
];

const SPINE: Rect = { x: 50, y: 2, w: 50, h: 34 };
const REQ_BOX: Rect = { x: 50, y: 39, w: 50, h: 30 };
const PROMOTE: Rect = { x: 50, y: 72, w: 50, h: 22 };

const MARK_STYLE: Record<string, string> = {
  stated: "bg-limewash text-moss",
  inferred: "bg-stone-100 text-steel",
  default: "bg-transparent text-stone-400 border border-dashed border-stone-300",
};

const STATUS: Record<number, string> = {
  0: "role-intake-v2 · session open",
  1: "the opener is deterministic — identical with or without an API key",
  3: "spine_provenance.title = stated",
  5: "spine_provenance.seniority = inferred",
  7: "BriefRequirement · kind=must_have · hardness=prerequisite",
  8: "spine_provenance.role_family = default — nobody said, so it is marked",
  9: "detect_shape → power_unit",
  10: "read-back before anything is committed",
  11: "promote → the same three-pass build",
};

function statusAt(phase: number): string {
  for (let p = phase; p >= 0; p--) if (STATUS[p]) return STATUS[p];
  return STATUS[0];
}

const plan = (t: number, commits = true): StagePlan => ({ shell: Math.max(0, t - 1), body: t, detail: t, chosen: commits ? t : null });

export function JdIntake() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          {/* Each captured field draws back to the turn that produced it, so a
              reader can see that `inferred` came from an answer that never said
              the word — and that `default` came from no turn at all. */}
          <Wire d="M 42 24.5 C 46 24.5, 46 10, 50 10" drawn={at(3)} stroke={INK.good} width={0.4} reduced={reduced} />
          <Wire d="M 42 24.5 C 46 24.5, 46 19, 50 19" drawn={at(5)} stroke={INK.line} width={0.4} reduced={reduced} />
          <Wire d="M 42 55.5 C 46 55.5, 46 50, 50 50" drawn={at(7)} stroke={INK.good} width={0.4} reduced={reduced} />
        </Wires>

        {/* ── The conversation ──────────────────────────────────────────── */}
        {TURNS.map((turn, i) => {
          const stage = stageOf(plan(turn.at, false), phase);
          const mine = turn.who === "you";
          return (
            <Slot key={i} rect={turn.rect} stage={stage} reduced={reduced} className={`p-3 ${mine ? "" : ""}`}>
              <p className={`text-meta uppercase tracking-wide ${mine ? "text-coral" : "text-steel"}`}>
                {mine ? "You" : "Intake"}
              </p>
              <Part show={at(turn.at)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
                {turn.text}
              </Part>
            </Slot>
          );
        })}

        {/* ── The brief spine ───────────────────────────────────────────── */}
        <Slot rect={SPINE} stage={stageOf(plan(3, false), phase)} reduced={reduced} className="p-3">
          <p className="text-meta uppercase tracking-wide text-steel">RoleBrief · spine</p>
          <dl className="mt-2 space-y-2">
            {FIELDS.map((f, i) => (
              <div key={f.key} className="flex items-center justify-between gap-2">
                <dt className="font-mono text-meta text-steel">{f.key}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <Part show={at(f.at)} i={i} reduced={reduced} className="truncate text-base text-ink">
                    {f.value}
                  </Part>
                  <Part
                    show={at(f.at)}
                    i={i}
                    lead={0.08}
                    reduced={reduced}
                    className={`shrink-0 rounded-full px-2 py-0.5 text-meta ${MARK_STYLE[f.mark]}`}
                  >
                    {f.mark}
                  </Part>
                </dd>
              </div>
            ))}
          </dl>
          <Part show={at(9)} reduced={reduced} className="mt-2.5 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-meta text-steel">
            shape: power_unit
          </Part>
        </Slot>

        {/* ── Graded requirements ───────────────────────────────────────── */}
        <Slot rect={REQ_BOX} stage={stageOf(plan(7, false), phase)} reduced={reduced} className="p-3">
          <p className="text-meta uppercase tracking-wide text-steel">Requirements · graded, not listed</p>
          <ul className="mt-2 space-y-1.5">
            {REQS.map((r, i) => (
              <li key={r.skill} className="flex items-center gap-2">
                {/* The weight is drawn as a bar as well as printed, so the
                    difference between a 0.8 and a 0.4 is legible before you
                    read the number. */}
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-stone-100">
                  <motion.span
                    className={`block h-full rounded-full ${r.weight === "0.8" ? "bg-moss" : "bg-dial-amber"}`}
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: at(r.at) ? Number(r.weight) : 0 }}
                    style={{ originX: 0 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <Part show={at(r.at)} i={i} reduced={reduced} className="min-w-0 truncate text-base text-ink">
                  {r.skill}
                </Part>
                <Part show={at(r.at)} i={i} lead={0.1} reduced={reduced} className="ml-auto shrink-0 font-mono text-meta text-steel">
                  {r.weight}
                </Part>
              </li>
            ))}
          </ul>
        </Slot>

        {/* ── The handoff ───────────────────────────────────────────────── */}
        <Slot rect={PROMOTE} stage={stageOf(plan(11), phase)} chosen={at(11)} reduced={reduced} className="p-3">
          <p className="text-meta uppercase tracking-wide text-steel">Promote</p>
          <Part show={at(11)} reduced={reduced} className="mt-1 flex items-center gap-2 text-base text-ink">
            The brief becomes the need
            <ArrowRight size={15} className="text-coral" aria-hidden />
            <span className="font-medium">three-pass build</span>
          </Part>
          <Part show={at(11)} i={1} reduced={reduced} className="mt-1.5 block text-meta text-steel">
            Nothing was written to the library until you saw the read-back.
          </Part>
        </Slot>
      </Field>

      <motion.p
        key={statusAt(phase)}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={`mt-4 font-mono text-meta text-steel ${SKIN}`}
      >
        {statusAt(phase)}
      </motion.p>
    </div>
  );
}
