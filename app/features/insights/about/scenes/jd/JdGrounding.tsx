"use client";

import { motion } from "framer-motion";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK, SKIN } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bowFor, leftOf, rightOf, sCurve } from "../../stage/threads";

/*
 * Variant B — THE GROUNDING.
 *
 * Metaphor: a ledger with receipts. Where variant A argues about control, this
 * one argues about *trust*: the generator is not allowed to invent a
 * requirement, so every must-have on the right keeps a visible thread back to
 * the source on the left that justifies it.
 *
 * The scene's whole point is the seventh row. A plausible, attractive
 * requirement — "Kafka" — arrives like all the others, finds nothing to attach
 * to, and fades out unprinted. That is the prompt rule made visible ("every
 * mustHave must trace to something the need/JD/analysis actually STATES"), and
 * it is far more convincing as an absence you watch happen than as a claim.
 *
 * Beats (CYCLE = 15 @ 900ms ≈ 13.5s):
 *   0 outline · 1 sources · 2 rows open · 3-8 six requirements attach, one per
 *   beat · 9 the seventh fails to attach · 10 it fades · 11 the gap is reported
 *   · 12 the cap chip · 13-14 hold
 *
 * `stillTick` is 13 — six attached rows, the seventh gone, the gap named.
 */

const CYCLE = 15;
const STILL = 13;

// ── Geometry ────────────────────────────────────────────────────────────────
const SOURCES: { rect: Rect; label: string; detail: string }[] = [
  { rect: { x: 0, y: 4, w: 30, h: 22 }, label: "Your need", detail: "What you typed or dictated" },
  { rect: { x: 0, y: 33, w: 30, h: 22 }, label: "The JD text", detail: "First 4 000 characters" },
  { rect: { x: 0, y: 62, w: 30, h: 22 }, label: "The codebase", detail: "31k LOC · languages · deps" },
];

// Right-hand rows. `src` is the index of the source each one attaches to;
// `null` means nothing in the inputs states it — the row that never prints.
const REQS: { skill: string; src: number | null; kind: "must" | "nice" }[] = [
  { skill: "TypeScript", src: 2, kind: "must" },
  { skill: "React 19", src: 2, kind: "must" },
  { skill: "Postgres or SQLite", src: 1, kind: "must" },
  { skill: "Owning a service end to end", src: 0, kind: "must" },
  { skill: "Czech + English", src: 0, kind: "must" },
  { skill: "Playwright", src: 1, kind: "nice" },
  { skill: "Kafka", src: null, kind: "must" },
];

const ROW_H = 10.5;
const ROW_GAP = 1.8;
const rowRect = (i: number): Rect => ({ x: 46, y: 4 + i * (ROW_H + ROW_GAP), w: 54, h: ROW_H });

// Each row lands on its own beat, starting at 3.
const landsAt = (i: number) => 3 + i;

/** Anchors come from the shared helpers, so they are derived from the same
 *  rects the boxes are drawn from and can never point at empty space. */
function thread(i: number): string {
  return sCurve(rightOf(SOURCES[REQS[i].src as number].rect), leftOf(rowRect(i)), bowFor(i));
}

const STATUS: Record<number, string> = {
  0: "role-design-v4 · grounding rules active",
  2: "candidate requirements: 7",
  3: "each must trace to something the inputs actually state",
  9: "Kafka — no supporting statement in any input",
  10: "dropped before it reached the document",
  11: "statedVsRealGaps: reported to you instead",
  12: "6 must-haves kept · hard cap 8",
};

function statusAt(phase: number): string {
  for (let p = phase; p >= 0; p--) if (STATUS[p]) return STATUS[p];
  return STATUS[0];
}

export function JdGrounding() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          {REQS.map((req, i) =>
            req.src === null ? null : (
              <Wire
                key={req.skill}
                d={thread(i)}
                drawn={at(landsAt(i))}
                stroke={req.kind === "must" ? INK.line : INK.quiet}
                width={0.4}
                reduced={reduced}
              />
            ),
          )}
        </Wires>

        {/* ── The inputs ────────────────────────────────────────────────── */}
        {SOURCES.map((s, i) => (
          <Slot key={s.label} rect={s.rect} stage={stageOf({ shell: 1, body: 1, detail: 2, chosen: null }, phase)} reduced={reduced} className="p-3">
            <p className="text-meta uppercase tracking-wide text-steel">Input</p>
            <Part show={at(1)} i={i} reduced={reduced} className="mt-1 block font-medium text-ink">
              {s.label}
            </Part>
            <Part show={at(2)} i={i} lead={0.08} reduced={reduced} className="mt-1 block text-meta text-steel">
              {s.detail}
            </Part>
          </Slot>
        ))}

        {/* ── The requirements ──────────────────────────────────────────── */}
        {REQS.map((req, i) => {
          const orphan = req.src === null;
          const landed = at(landsAt(i));
          // The orphan is mounted like every other row — it holds its space,
          // then loses opacity. Removing it from the tree would collapse the
          // stack and shift the six rows above it, which would read as a
          // layout bug rather than as a requirement being rejected.
          const faded = orphan && at(10);
          return (
            <motion.div
              key={req.skill}
              initial={false}
              animate={{ opacity: faded ? 0.25 : 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
              className="absolute"
              style={{
                left: `${rowRect(i).x}%`,
                top: `${rowRect(i).y}%`,
                width: `${rowRect(i).w}%`,
                height: `${rowRect(i).h}%`,
              }}
            >
              <div
                className={`flex h-full items-center gap-2.5 rounded-lg border px-3 ${SKIN} ${
                  landed && !orphan
                    ? "border-stone-200 bg-white shadow-panel"
                    : landed && orphan
                      ? "border-dashed border-coral bg-transparent"
                      : "border-dashed border-stone-300 bg-transparent"
                }`}
              >
                <Part
                  show={landed}
                  reduced={reduced}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-meta ${
                    orphan
                      ? "bg-coral/10 text-coral"
                      : req.kind === "must"
                        ? "bg-stone-100 text-steel"
                        : "bg-stone-50 text-stone-500"
                  }`}
                >
                  {orphan ? "no source" : req.kind === "must" ? "must have" : "nice to have"}
                </Part>
                <Part show={landed} i={1} reduced={reduced} className="min-w-0 truncate text-base text-ink">
                  {req.skill}
                </Part>
              </div>
            </motion.div>
          );
        })}

        {/* ── What happened to the orphan ───────────────────────────────── */}
        <div className="absolute left-[46%] top-[92%] w-[54%]">
          <Part show={at(11)} reduced={reduced} className="block text-base text-ink">
            Stated stack not evident in the codebase: <span className="font-medium text-coral">Kafka</span>
          </Part>
          <Part show={at(12)} i={1} reduced={reduced} className="mt-1 block text-meta text-steel">
            Surfaced to you as a gap to resolve — not quietly written into the role.
          </Part>
        </div>
      </Field>

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
