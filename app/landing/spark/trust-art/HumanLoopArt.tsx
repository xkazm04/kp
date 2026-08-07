"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Lock, Stamp } from "lucide-react";
import { AMBER, CORAL, HAND, INK, LIMEWASH, MOSS, STEEL } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { CARD, cycle } from "./shared";

/*
 * 01 · Human in the loop — the pipeline runs itself right up to the barrier.
 *
 * The claim is "no candidate is advanced, offered or rejected by the machine
 * alone", so the drawing is literal: a candidate token rides the rail through
 * intake and scoring on its own, then STOPS at a gate whose barrier is down.
 * Nothing moves again until a stamp lands with a person's name on it. The wait
 * is the point — an illustration where the token sailed through would be
 * arguing the opposite claim.
 *
 * Below the rail, the three toggles answer the follow-up question a buyer
 * actually asks: *which* steps may run unattended. Two flip. The third does
 * not, because "every adverse decision is reviewed and made by a person — by
 * design, not by a setting" has to survive contact with the setting.
 */

// One full pass of the pipeline, in seconds. Every keyframe track below is
// expressed as fractions of it, which is what keeps the stamp landing on the
// same beat as the barrier lift.
const DUR = 7.4;

// Illustrative data, not copy: the fictional candidate riding the rail and the
// fit the machine produced. Held as constants so a translator never sees them
// and the i18n lint can tell them apart from strings — the same rule the
// preview mockups follow for `AXIS` and their candidate names.
const CANDIDATE = "JN";
const FIT = 87;

// Where each station sits along the rail. Percentages, not pixels: the stage is
// fluid and the token has to land on the node at every width.
const STATIONS = [
  { key: "intake", at: "12%", color: STEEL },
  { key: "score", at: "37%", color: AMBER },
  { key: "gate", at: "63%", color: CORAL },
  { key: "hired", at: "88%", color: MOSS }
] as const;

// Which steps may act unattended. `reject` is locked on purpose — see above.
const GATES = [
  { key: "screen", locked: false, auto: true },
  { key: "schedule", locked: false, auto: true },
  { key: "reject", locked: true, auto: false }
] as const;

const CONFETTI = [
  { c: AMBER, dx: -22, dy: -20 },
  { c: CORAL, dx: 20, dy: -26 },
  { c: LIMEWASH, dx: 26, dy: 12 }
] as const;

function AllowToggle({ gate }: { gate: (typeof GATES)[number] }) {
  const t = useTranslations("landing");
  const [auto, setAuto] = useState(gate.auto);
  const [refused, setRefused] = useState(0);
  const on = gate.locked ? false : auto;
  const label = t(`trust.art.human.gates.${gate.key}`);

  return (
    <button
      type="button"
      onClick={() => (gate.locked ? setRefused((n) => n + 1) : setAuto((a) => !a))}
      aria-label={t("trust.art.human.toggleAria", { step: label, mode: t(on ? "trust.art.human.auto" : "trust.art.human.you") })}
      className="flex items-center gap-2 focus-ring rounded-xl px-1 py-0.5"
    >
      <span className="text-sm font-bold" style={{ color: STEEL }}>
        {label}
      </span>
      {/* The refusal is animated, not disabled: a dead control reads as broken,
          a control that visibly shakes its head reads as a rule. */}
      <motion.span
        key={refused}
        animate={gate.locked && refused > 0 ? { x: [0, -4, 4, -3, 0] } : undefined}
        transition={{ duration: 0.34 }}
        className="relative flex items-center rounded-full border-[3px] border-[#17202a] bg-white p-0.5 shadow-[2px_2px_0_#17202a]"
      >
        {(["auto", "you"] as const).map((mode) => {
          const active = (mode === "auto") === on;
          return (
            <span key={mode} className="relative px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide">
              {active && (
                <motion.span
                  layoutId={`allow-${gate.key}`}
                  className="absolute inset-0 rounded-full"
                  style={{ background: mode === "auto" ? LIMEWASH : MOSS }}
                  transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
                />
              )}
              <span className="relative" style={{ color: active && mode === "you" ? "#fff" : INK }}>
                {t(`trust.art.human.${mode}`)}
              </span>
            </span>
          );
        })}
        {gate.locked && (
          <Lock className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-white" style={{ color: CORAL }} aria-hidden />
        )}
      </motion.span>
    </button>
  );
}

export default function HumanLoopArt() {
  const t = useTranslations("landing");
  const rm = useStillMotion();

  return (
    <div className="w-full">
      <div className="relative mx-auto h-[196px] w-full max-w-[560px]">
        {/* The rail. The dashed overlay marches only across the stretch the
            machine owns — it stops dead at the gate, which is the whole idea. */}
        <div className="absolute left-[12%] right-[12%] top-[74px] h-1.5 rounded-full" style={{ background: LIMEWASH }} />
        <svg className="absolute left-[12%] right-[12%] top-[71px] h-2 w-[76%]" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden>
          <motion.line
            x1="0"
            y1="4"
            x2="66"
            y2="4"
            stroke={STEEL}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="6 6"
            animate={rm ? undefined : { strokeDashoffset: [0, -24] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
        </svg>

        {STATIONS.map((s, i) => (
          <div key={s.key} className="absolute w-[4.5rem] -translate-x-1/2 text-center sm:w-24" style={{ left: s.at, top: 46 }}>
            <motion.span
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.09, type: "spring", bounce: 0.5 }}
              className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border-[3px] border-[#17202a] text-xs font-extrabold text-white shadow-[3px_3px_0_#17202a] sm:h-14 sm:w-14"
              style={{ background: s.color }}
            >
              {i + 1}
            </motion.span>
            <p className="mt-2 text-[13px] font-bold leading-tight sm:text-xs" style={{ color: STEEL }}>
              {t(`trust.art.human.stations.${s.key}`)}
            </p>
          </div>
        ))}

        {/* The barrier — down by default, lifted only after the stamp lands. */}
        <div className="absolute -translate-x-1/2" style={{ left: "63%", top: 22 }}>
          <motion.span
            className="block h-1.5 w-16 origin-left rounded-full"
            style={{ background: INK }}
            {...cycle(rm, DUR, { rotate: [0, 0, -78, -78, 0] }, [0, 0.7, 0.76, 0.94, 0.98], { rotate: -78 })}
            aria-hidden
          />
        </div>

        {/* The score the machine produced — it recommends, it does not decide. */}
        <motion.span
          className="absolute -translate-x-1/2 rounded-full border-[3px] border-[#17202a] px-2 py-0.5 text-xs font-extrabold text-white shadow-[2px_2px_0_#17202a]"
          style={{ left: "37%", top: 14, background: MOSS }}
          initial={{ opacity: 0, scale: 0.4 }}
          {...cycle(
            rm,
            DUR,
            { opacity: [0, 0, 1, 1, 0], scale: [0.4, 0.4, 1, 1, 0.4] },
            [0, 0.23, 0.3, 0.92, 0.97],
            { opacity: 1, scale: 1 }
          )}
        >
          {t("trust.art.human.score", { fit: FIT })}
        </motion.span>

        {/* "Waiting for you" — the beat that makes the claim visible. */}
        <motion.span
          className={`${HAND} absolute -translate-x-1/2 whitespace-nowrap text-sm`}
          style={{ left: "63%", top: 150, color: CORAL }}
          initial={{ opacity: 0 }}
          {...cycle(rm, DUR, { opacity: [0, 0, 1, 1, 0, 0] }, [0, 0.5, 0.55, 0.66, 0.7, 1], { opacity: 0 })}
        >
          {t("trust.art.human.waiting")}
        </motion.span>

        {/* The signature. Slams down oversized and settles askew, like every
            other stamp on this page. */}
        <motion.span
          className="absolute flex -translate-x-1/2 items-center gap-1.5 rounded-lg border-[3px] border-[#17202a] px-2 py-1 text-xs font-extrabold text-white shadow-[2px_2px_0_#17202a]"
          style={{ left: "63%", top: 148, background: MOSS }}
          initial={{ opacity: 0, scale: 2.2, rotate: 10 }}
          {...cycle(
            rm,
            DUR,
            { opacity: [0, 0, 1, 1, 0], scale: [2.2, 2.2, 1, 1, 1], rotate: [10, 10, -5, -5, -5] },
            [0, 0.66, 0.74, 0.93, 0.97],
            { opacity: 1, scale: 1, rotate: -5 }
          )}
        >
          <Stamp className="h-3.5 w-3.5" aria-hidden />
          {t("trust.art.human.signed", { name: "M. Horáková" })}
        </motion.span>

        {/* The candidate. Rides the rail alone, waits at the gate, moves on. */}
        <motion.span
          className="absolute grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border-[3px] border-[#17202a] text-xs font-extrabold shadow-[2px_2px_0_#17202a]"
          initial={{ left: "12%", opacity: 0 }}
          style={{ top: 58, background: "#fff" }}
          {...cycle(
            rm,
            DUR,
            {
              left: ["12%", "12%", "12%", "37%", "37%", "63%", "63%", "88%", "88%", "88%"],
              opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 0]
            },
            [0, 0.04, 0.14, 0.24, 0.4, 0.5, 0.76, 0.86, 0.95, 1],
            { left: "88%", opacity: 1 }
          )}
        >
          {CANDIDATE}
        </motion.span>

        {CONFETTI.map((c, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-[#17202a]"
            initial={{ opacity: 0 }}
            style={{ left: "88%", top: 62, background: c.c }}
            {...cycle(
              rm,
              DUR,
              { opacity: [0, 0, 1, 0], x: [0, 0, c.dx, c.dx], y: [0, 0, c.dy, c.dy - 6] },
              [0, 0.87, 0.92, 0.99],
              { opacity: 0, x: c.dx, y: c.dy }
            )}
          />
        ))}
      </div>

      <div className={`${CARD} mx-auto w-full max-w-[560px] p-3`}>
        <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: STEEL }}>
          {t("trust.art.human.allowTitle")}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          {GATES.map((g) => (
            <AllowToggle key={g.key} gate={g} />
          ))}
        </div>
        <p className={`${HAND} mt-1.5 text-sm`} style={{ color: CORAL }}>
          {t("trust.art.human.lockedNote")}
        </p>
      </div>
    </div>
  );
}
