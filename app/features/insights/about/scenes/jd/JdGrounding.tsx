"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK, SKIN } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bowFor, leftOf, rightOf, sCurve } from "../../stage/threads";
import { SceneStatus, statusPicker } from "../shared";

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
// Structure only. Labels resolve from `about.jd.sources.*` at render time.
const SOURCES: { rect: Rect; key: "need" | "jd" | "code" }[] = [
  { rect: { x: 0, y: 4, w: 30, h: 22 }, key: "need" },
  { rect: { x: 0, y: 33, w: 30, h: 22 }, key: "jd" },
  { rect: { x: 0, y: 62, w: 30, h: 22 }, key: "code" },
];

/*
 * Right-hand rows. `src` is the index of the source each one attaches to;
 * `null` means nothing in the inputs states it — the row that never prints.
 *
 * Two kinds of row label, and the difference is a localization rule rather than
 * a styling one (the same rule `CodeLabel`'s `code` prop states):
 *
 *   text: "code"  — a product noun. "TypeScript", "React 19", "Playwright",
 *                   "Kafka" are the same word in every locale, and putting them
 *                   in the catalog would invite four translators to render them
 *                   four ways. They stay here.
 *   text: "prose" — a requirement written as a SENTENCE. "Owning a service end
 *                   to end" is English, not an identifier, and shipping it from
 *                   this array meant a Czech reader met three untranslated
 *                   lines in the middle of a translated deck. These resolve
 *                   from `about.jd.reqs.<key>`.
 *
 * `id` is the React key and stays stable across locales; it is never rendered.
 */
type ReqKey = "stack" | "ownership" | "languages";

type Req = { id: string; src: number | null; kind: "must" | "nice" } & (
  | { text: "code"; code: string }
  | { text: "prose"; key: ReqKey }
);

const REQS: Req[] = [
  { id: "typescript", text: "code", code: "TypeScript", src: 2, kind: "must" },
  { id: "react", text: "code", code: "React 19", src: 2, kind: "must" },
  { id: "stack", text: "prose", key: "stack", src: 1, kind: "must" },
  { id: "ownership", text: "prose", key: "ownership", src: 0, kind: "must" },
  { id: "languages", text: "prose", key: "languages", src: 0, kind: "must" },
  { id: "playwright", text: "code", code: "Playwright", src: 1, kind: "nice" },
  { id: "kafka", text: "code", code: "Kafka", src: null, kind: "must" },
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

export function JdGrounding() {
  const t = useTranslations("about.jd");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;
  const statusAt = statusPicker({
    0: t("status.s0"),
    2: t("status.s2"),
    3: t("status.s3"),
    9: t("status.s9"),
    10: t("status.s10"),
    11: t("status.s11"),
    12: t("status.s12"),
  });

  return (
    <div ref={ref}>
      <Field min="min-h-[32rem] sm:min-h-[36rem]">
        <Wires>
          {REQS.map((req, i) =>
            req.src === null ? null : (
              <Wire
                key={req.id}
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
          <Slot key={s.key} rect={s.rect} stage={stageOf({ shell: 1, body: 1, detail: 2, chosen: null }, phase)} reduced={reduced} className="p-3">
            <p className="text-meta uppercase tracking-wide text-steel">{t("input")}</p>
            <Part show={at(1)} i={i} reduced={reduced} className="mt-1 block font-medium text-ink">
              {t(`sources.${s.key}Label`)}
            </Part>
            <Part show={at(2)} i={i} lead={0.08} reduced={reduced} className="mt-1 block text-meta text-steel">
              {t(`sources.${s.key}Detail`)}
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
              key={req.id}
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
                  {orphan ? t("noSource") : req.kind === "must" ? t("must") : t("nice")}
                </Part>
                <Part show={landed} i={1} reduced={reduced} className="min-w-0 truncate text-base text-ink">
                  {req.text === "code" ? req.code : t(`reqs.${req.key}`)}
                </Part>
              </div>
            </motion.div>
          );
        })}

        {/* ── What happened to the orphan ───────────────────────────────── */}
        <div className="absolute left-[46%] top-[92%] w-[54%]">
          <Part show={at(11)} reduced={reduced} className="block text-base text-ink">
            {t.rich("gap", { k: (chunks) => <span className="font-medium text-coral">{chunks}</span> })}
          </Part>
          <Part show={at(12)} i={1} reduced={reduced} className="mt-1 block text-meta text-steel">
            {t("gapNote")}
          </Part>
        </div>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
