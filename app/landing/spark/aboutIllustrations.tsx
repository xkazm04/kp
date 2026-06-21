"use client";

import { motion } from "framer-motion";
import { Check, FileText, Inbox, Mic, Stamp } from "lucide-react";

/*
 * Enter-animated step illustrations for the /about "Drawn curve" — one per
 * pipeline phase, each leading with that step's highest-value moment. They
 * replay every time they re-enter the viewport (once:false) so scrolling up and
 * down keeps the page alive. The in-illustration micro-labels are deliberately
 * left in English — they're stylised product mockups (same call as the landing
 * feature spotlights); the page's actual copy is translated via the `aboutPage`
 * namespace. Spark art direction → literal hexes.
 */
export type AboutStepKey = "design" | "source" | "intake" | "screen" | "interview" | "offer" | "hired";

const DISPLAY = "font-[family-name:var(--font-spark-display)]";
const HAND = "font-[family-name:var(--font-spark-hand)]";

const ENTER = { once: false, amount: 0.5 } as const;
const DRAW = { duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

// 01 · Design — a JD assembling itself: title, must-have chips, salary band.
function RoleSpecArt({ color = "#42606f" }: { color?: string }) {
  const chips = ["Java", "Spring", "SQL", "REST"];
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center gap-3">
        <span
          className={`${DISPLAY} grid h-10 w-10 place-items-center rounded-xl border-[3px] border-[#17202a] text-sm font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: color }}
        >
          JD
        </span>
        <div>
          <p className="text-sm font-bold">Senior Java Engineer</p>
          <p className="text-xs font-bold text-[#42606f]">Česká spořitelna · senior</p>
        </div>
      </div>
      <p className={`${HAND} mt-4 text-sm text-[#526b4f]`}>must-haves</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <motion.span
            key={c}
            initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
            whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
            viewport={ENTER}
            transition={{ delay: 0.15 + i * 0.1, type: "spring", bounce: 0.5 }}
            className="rounded-full border-[3px] border-[#17202a] bg-[#fdf8ee] px-3 py-1 text-sm font-bold shadow-[2px_2px_0_#17202a]"
          >
            {c}
          </motion.span>
        ))}
      </div>
      <p className={`${HAND} mt-4 text-sm text-[#526b4f]`}>salary band · CZK</p>
      <div className="mt-1 h-4 w-full overflow-hidden rounded-full border-[3px] border-[#17202a] bg-[#dce7d0]">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: "72%" }}
          viewport={ENTER}
          transition={{ ...DRAW, delay: 0.4 }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <p className="mt-1 text-sm font-bold text-[#42606f]">120k — 165k</p>
    </div>
  );
}

// 02 · Source — candidates ranked against the role, bars filling to match %.
function SourceRankArt({ color = "#caa54c" }: { color?: string }) {
  const rows = [
    { name: "Jana N.", role: "Backend", v: 88 },
    { name: "Petr K.", role: "Full-stack", v: 74 },
    { name: "Alex T.", role: "Java", v: 61 }
  ];
  return (
    <div className="mx-auto w-full max-w-md space-y-2.5">
      {rows.map((r, i) => (
        <motion.div
          key={r.name}
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={ENTER}
          transition={{ delay: i * 0.12, type: "spring", bounce: 0.3 }}
          className="flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] bg-white p-3 shadow-[4px_4px_0_#17202a]"
        >
          <span
            className={`${DISPLAY} grid h-8 w-8 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a] text-sm font-extrabold text-white`}
            style={{ background: color }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {r.name} · <span className="text-[#42606f]">{r.role}</span>
            </p>
            <div className="mt-1 h-2.5 w-full rounded-full bg-[#dce7d0]">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${r.v}%` }}
                viewport={ENTER}
                transition={{ ...DRAW, delay: 0.2 + i * 0.12 }}
                className="h-full rounded-full"
                style={{ background: color }}
              />
            </div>
          </div>
          <span className={`${DISPLAY} text-lg font-extrabold`}>{r.v}</span>
        </motion.div>
      ))}
    </div>
  );
}

// 03 · Intake — five channels fly in and converge into one pipeline.
function IntakeArt({ color = "#d65a4a" }: { color?: string }) {
  const channels = ["Apply", "Email", "Boards", "Sourcing", "Manual"];
  return (
    <div className="mx-auto w-full max-w-md text-center">
      <div className="flex flex-wrap justify-center gap-2">
        {channels.map((c, i) => (
          <motion.span
            key={c}
            initial={{ opacity: 0, x: i % 2 ? 60 : -60, rotate: i % 2 ? 10 : -10 }}
            whileInView={{ opacity: 1, x: 0, rotate: i % 2 ? 1.5 : -1.5 }}
            viewport={ENTER}
            transition={{ delay: 0.1 + i * 0.09, type: "spring", bounce: 0.4 }}
            className="rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            {c}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={ENTER}
        transition={{ delay: 0.6, duration: 0.3 }}
        className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full bg-[#17202a]"
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: -8 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={ENTER}
        transition={{ delay: 0.8, type: "spring", bounce: 0.5 }}
        className="relative mx-auto inline-flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] px-6 py-4 shadow-[5px_5px_0_#17202a]"
        style={{ background: "#dce7d0" }}
      >
        <Inbox className="h-6 w-6" />
        <span className={`${DISPLAY} text-lg font-bold`}>One pipeline</span>
        <motion.span
          initial={{ opacity: 0, scale: 2, rotate: 10 }}
          whileInView={{ opacity: 1, scale: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ delay: 1.05, type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} absolute -right-4 -top-4 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: color }}
        >
          47
        </motion.span>
      </motion.div>
    </div>
  );
}

// 04 · Screen — an evidence-backed fit dial that draws to 87 with factor chips.
function ScoreDialArt({ color = "#526b4f" }: { color?: string }) {
  const R = 70;
  const C = 2 * Math.PI * R;
  const factors = [
    { label: "Skills", v: "92%" },
    { label: "Seniority", v: "84%" },
    { label: "Evidence", v: "traced" }
  ];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
      <div className="relative grid h-56 w-56 place-items-center">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="#e7dcc8" strokeWidth="16" />
          <motion.circle
            cx="90"
            cy="90"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            whileInView={{ strokeDashoffset: C * (1 - 0.87) }}
            viewport={ENTER}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          whileInView={{ scale: 1, rotate: 0 }}
          viewport={ENTER}
          transition={{ type: "spring", bounce: 0.5, delay: 0.25 }}
          className={`${DISPLAY} absolute grid h-24 w-24 place-items-center rounded-full border-[3px] border-[#17202a] text-4xl font-extrabold text-white shadow-[4px_4px_0_#17202a]`}
          style={{ background: color }}
        >
          87
        </motion.div>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {factors.map((f, i) => (
          <motion.span
            key={f.label}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={ENTER}
            transition={{ delay: 0.4 + i * 0.12, type: "spring", bounce: 0.4 }}
            className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            <Check className="h-3.5 w-3.5" style={{ color }} aria-hidden />
            {f.label} · {f.v}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

const BUBBLES = [
  { ai: true, text: "You shipped a React app for class — what broke first with real users?" },
  { ai: false, text: "Honestly? State management. I rewrote it twice before it clicked." }
] as const;

// 05 · Interview — a voice screen card: live equalizer + transcript bubbles.
function VoiceArt({ color = "#d65a4a" }: { color?: string }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center gap-3 border-b-[3px] border-dashed border-[#dce7d0] pb-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
          style={{ background: color }}
        >
          <Mic className="h-4 w-4 text-white" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold">First-round screen</p>
          <p className="text-xs font-bold text-[#42606f]">live · 4:12</p>
        </div>
        <div className="flex h-6 items-end gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 rounded"
              style={{ background: color }}
              animate={{ height: [6, 24, 10, 22, 6] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        {BUBBLES.map((b, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, x: b.ai ? -18 : 18, scale: 0.9 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={ENTER}
            transition={{ delay: 0.25 + i * 0.3, type: "spring", bounce: 0.35 }}
            className={`max-w-[85%] rounded-2xl border-[3px] border-[#17202a] px-3.5 py-2 text-sm leading-snug ${
              b.ai ? "bg-[#fdf8ee]" : "ml-auto"
            }`}
            style={b.ai ? undefined : { background: "#dce7d0" }}
          >
            {b.text}
          </motion.p>
        ))}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={ENTER}
          transition={{ delay: 1, type: "spring", bounce: 0.4 }}
          className="mt-1 flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-3.5 py-2 text-sm font-bold text-white shadow-[3px_3px_0_#17202a]"
          style={{ background: "#526b4f" }}
        >
          <Check className="h-4 w-4" />
          Scorecard drafted on hang-up
        </motion.div>
      </div>
    </div>
  );
}

// 06 · Offer — deterministic figure, auto-drafted, human-approved, accepted.
function OfferArt({ color = "#caa54c" }: { color?: string }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center justify-between border-b-[3px] border-dashed border-[#dce7d0] pb-3">
        <p className={`${HAND} text-lg text-[#526b4f]`}>Offer letter</p>
        <FileText className="h-5 w-5 text-[#42606f]" />
      </div>
      <div className="mt-4 text-center">
        <motion.p
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={ENTER}
          transition={{ type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} text-4xl font-extrabold`}
        >
          150k <span className="text-base text-[#42606f]">CZK</span>
        </motion.p>
        <p className="text-sm font-bold text-[#42606f]">role band × fit · no LLM in the number</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <motion.span
          initial={{ scale: 2, opacity: 0, rotate: 12 }}
          whileInView={{ scale: 1, opacity: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
          className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] px-3 py-1 text-sm font-extrabold uppercase text-white shadow-[2px_2px_0_#17202a]"
          style={{ background: color }}
        >
          <Stamp className="h-3.5 w-3.5" /> human-approved
        </motion.span>
        <motion.span
          initial={{ opacity: 0, x: 16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={ENTER}
          transition={{ delay: 0.6, type: "spring", bounce: 0.4 }}
          className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-[#526b4f] px-3 py-1 text-sm font-bold text-white shadow-[2px_2px_0_#17202a]"
        >
          <Check className="h-3.5 w-3.5" /> accepted
        </motion.span>
      </div>
    </div>
  );
}

const CONFETTI = [
  { c: "#caa54c", left: "-8%", top: "8%" },
  { c: "#d65a4a", left: "104%", top: "0%" },
  { c: "#42606f", left: "100%", top: "78%" },
  { c: "#caa54c", left: "-6%", top: "82%" }
];

// 07 · Hired — a stamped seal + confetti, with onboarding already checking off.
function HiredArt({ color = "#526b4f" }: { color?: string }) {
  const tasks = ["Pre-boarding sent", "Equipment requested", "Buddy assigned"];
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative grid h-36 place-items-center">
        {CONFETTI.map((d, i) => (
          <motion.span
            key={i}
            aria-hidden
            initial={{ opacity: 0, scale: 0 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={ENTER}
            transition={{ delay: 0.4 + i * 0.1, type: "spring", bounce: 0.6 }}
            className="absolute h-3 w-3 rounded-full border-2 border-[#17202a]"
            style={{ background: d.c, left: d.left, top: d.top }}
          />
        ))}
        <motion.div
          initial={{ scale: 2.2, opacity: 0, rotate: 12 }}
          whileInView={{ scale: 1, opacity: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} grid h-28 w-28 place-items-center rounded-full border-[4px] border-[#17202a] text-2xl font-extrabold uppercase text-white shadow-[5px_5px_0_#17202a]`}
          style={{ background: color }}
        >
          Hired
        </motion.div>
      </div>
      <div className="mt-5 space-y-2 rounded-2xl border-[3px] border-[#17202a] bg-white p-4 shadow-[5px_5px_0_#17202a]">
        <p className={`${HAND} text-sm text-[#526b4f]`}>onboarding · day one in motion</p>
        {tasks.map((task, i) => (
          <motion.div
            key={task}
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={ENTER}
            transition={{ delay: 0.3 + i * 0.18, type: "spring", bounce: 0.4 }}
            className="flex items-center gap-2 text-sm font-bold"
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
              style={{ background: color }}
            >
              <Check className="h-3 w-3 text-white" />
            </span>
            {task}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Dispatch a pipeline phase to its illustration.
export function StepArt({ stepKey, color }: { stepKey: AboutStepKey; color: string }) {
  switch (stepKey) {
    case "design":
      return <RoleSpecArt color={color} />;
    case "source":
      return <SourceRankArt color={color} />;
    case "intake":
      return <IntakeArt color={color} />;
    case "screen":
      return <ScoreDialArt color={color} />;
    case "interview":
      return <VoiceArt color={color} />;
    case "offer":
      return <OfferArt color={color} />;
    case "hired":
      return <HiredArt color={color} />;
  }
}
