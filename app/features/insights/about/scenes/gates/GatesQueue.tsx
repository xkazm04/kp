"use client";

import { useTranslations } from "next-intl";
import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK } from "../../stage/motion";
import type { Rect } from "../../stage/stages";
import { CodeLabel, SceneStatus, statusPicker } from "../shared";
import { ACTIONS, CYCLE, GATE_LABEL, STILL, sceneAt, type StatusBeat } from "./data";

/*
 * Chapter 6, variant A — WHAT FLOWS AND WHAT PARKS.
 *
 * Metaphor: a road with a barrier that only some traffic meets. The evidence
 * register becomes an accountability one: the claim is "a person decided", and
 * the evidence is that the machine physically cannot complete the action alone.
 *
 * The gate is one field. Setting a non-null `approvalKind` on a pipeline entry
 * is literally what parks a candidate in the Decisions queue, and
 * `needsHumanDecision` returns true only for a RECOGNISED kind, so a typo
 * cannot masquerade as a real gate.
 *
 * The scene's load-bearing row is the rejection. The unattended pass computes
 * it, clears it through the fairness gate, and then refuses to apply it,
 * queueing it as `rejection_review` instead. The comment in
 * automation-pass.ts calls this out by name: a rejection is the one
 * irreversible, candidate-visible adverse action, so the pass never applies one
 * on its own. Advances, holds and alerts continue autonomously, and saying so
 * is what makes the claim credible rather than marketing.
 *
 * The beat table (CYCLE, STILL, which beat each mark lands on) and the
 * approval kinds chapters.test.ts pins live in `./data.ts`, where node:test can
 * import and walk them; this file is geometry and words.
 */

// ── Geometry ────────────────────────────────────────────────────────────────
const ROW_H = 12.5;
const ROW_GAP = 2.5;
const fromRect = (i: number): Rect => ({ x: 0, y: 4 + i * (ROW_H + ROW_GAP), w: 40, h: ROW_H });
const toRect = (i: number): Rect => ({ x: 60, y: 4 + i * (ROW_H + ROW_GAP), w: 40, h: ROW_H });

const BAR_X = 50;
const NOTE: Rect = { x: 0, y: 70, w: 100, h: 30 };


export function GatesQueue() {
  const t = useTranslations("about.gates");
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const s = sceneAt(phase);
  const statusAt = statusPicker({
    0: t("status.s0"),
    2: t("status.s2"),
    3: t("status.s3"),
    4: t("status.s4"),
    5: t("status.s5"),
    6: t("status.s6"),
    7: t("status.s7"),
    9: t("status.s9"),
  } satisfies Record<StatusBeat, string>);

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          {ACTIONS.map((a, i) => {
            const y = fromRect(i).y + ROW_H / 2;
            return (
              <Wire
                key={a.id}
                d={a.parks ? `M 40 ${y} L ${BAR_X - 0.8} ${y}` : `M 40 ${y} L 60 ${y}`}
                drawn={s.met[i]}
                stroke={a.parks ? INK.act : INK.good}
                width={0.45}
                reduced={reduced}
              />
            );
          })}
        </Wires>

        {/* ── The barrier ───────────────────────────────────────────────── */}
        <div
          aria-hidden
          className="absolute z-10 border-l-2 border-coral"
          style={{
            left: `${BAR_X}%`,
            top: "2%",
            height: `${2 + ACTIONS.length * (ROW_H + ROW_GAP)}%`,
            opacity: s.barrier ? 1 : 0,
            transition: reduced ? "none" : "opacity 500ms ease-out",
          }}
        />
        <div className="absolute z-10 -translate-x-1/2" style={{ left: `${BAR_X}%`, top: "0%" }}>
          <Part show={s.barrier} reduced={reduced} className="whitespace-nowrap rounded-full bg-coral/10 px-2 py-0.5 font-mono text-meta text-coral">
            {t("gate")}
          </Part>
        </div>

        {ACTIONS.map((a, i) => {
          const met = s.met[i];
          return (
            <Slot
              key={a.id}
              rect={fromRect(i)}
              stage={s.from[i]}
              reduced={reduced}
              className="flex items-center gap-2 px-3"
            >
              <Part show={s.proposed} i={i} reduced={reduced} className="min-w-0 flex-1 truncate text-base text-ink">
                {t(`actions.${a.key}`)}
              </Part>
              <Part show={met && a.parks} reduced={reduced} className="shrink-0 text-meta font-medium text-coral">
                {t("stops")}
              </Part>
            </Slot>
          );
        })}

        {ACTIONS.map((a, i) => {
          const met = s.met[i];
          return (
            <Slot
              key={a.id}
              rect={toRect(i)}
              stage={s.to[i]}
              // Deliberately NOT `chosen`. That prop paints the coral commit
              // edge, and coral is already doing two jobs in this scene: the
              // barrier itself and the rows that stop at it. Giving the rows
              // that pass the same colour inverts the reading. The outcome is
              // carried by the text tone instead, moss for applied and coral
              // for the approval kind that is now waiting on someone.
              reduced={reduced}
              className="flex items-center px-3"
            >
              {a.parks ? (
                <Part show={met} reduced={reduced} className="font-mono text-meta text-coral">
                  {a.kind}
                </Part>
              ) : (
                <Part show={met} reduced={reduced} className="text-base text-moss">
                  {t("applied")}
                </Part>
              )}
            </Slot>
          );
        })}

        <Slot rect={NOTE} stage={s.note} reduced={reduced} className="p-4">
          <CodeLabel code={GATE_LABEL} />
          <Part show={s.rejection} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            {t("noteRejection")}
          </Part>
          <Part show={s.autonomous} i={1} reduced={reduced} className="mt-2.5 block text-base leading-snug text-ink">
            {t("noteAutonomous")}
          </Part>
          <Part show={s.hired} i={2} reduced={reduced} className="mt-2.5 block text-base leading-snug text-ink">
            {t("noteHired")}
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}
