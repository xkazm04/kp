"use client";

import type { ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Check,
  FileSearch,
  FileSignature,
  FlaskConical,
  Gauge,
  History,
  Inbox,
  Mail,
  Mic,
  MousePointerClick,
  Newspaper,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { AMBER, CORAL, CREAM, DISPLAY, HAND, INK, LIMEWASH, MOSS, STEEL } from "./tokens";

/*
 * Feature spotlights — the Signal variant's product figures, re-skinned into
 * Spark's sticker language and re-choreographed to pop, stamp and deal like
 * the rest of the page. Hovering a feature card opens its spotlight; a
 * click/tap (or Enter) pins it so touch and keyboard users get the same show.
 * Content remounts per preview, so every entrance replays on each peek.
 */
// The grid is the app's shop window, so it has to keep pace with the app. `cases`,
// `offer` and `rediscover` were shipped features with no card — and `cases` in
// particular is the one capability no competitor has, sitting invisible behind a
// "Dev cases" tab. Nine keys also squares the lg:grid-cols-3 layout.
export type PreviewKey = "score" | "voice" | "cases" | "schedule" | "inbox" | "salary" | "rediscover" | "offer" | "gates";

const pop = (delay: number) => ({
  initial: { opacity: 0, scale: 0.6, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: { delay, type: "spring" as const, bounce: 0.45 }
});

const stamp = (delay: number) => ({
  initial: { opacity: 0, scale: 2.2, rotate: 10 },
  animate: { opacity: 1, scale: 1, rotate: -6 },
  transition: { delay, type: "spring" as const, bounce: 0.45 }
});

/* ── 01 · Job-fit scoring — the dial, stamped ───────────────────── */
function ScorePreview() {
  const R = 56;
  const C = 2 * Math.PI * R;
  const factors = [
    { label: "Skills match", v: 92, color: MOSS },
    { label: "Seniority signal", v: 84, color: MOSS },
    { label: "Domain overlap", v: 61, color: AMBER }
  ];
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 144 144" className="h-full w-full -rotate-90">
          <circle cx="72" cy="72" r={R} fill="none" stroke={LIMEWASH} strokeWidth="14" />
          <motion.circle
            cx="72"
            cy="72"
            r={R}
            fill="none"
            stroke={MOSS}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - 0.87) }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
          />
        </svg>
        <motion.div {...stamp(0.85)} className="absolute inset-0 grid place-items-center">
          <div
            className={`${DISPLAY} grid h-20 w-20 place-items-center rounded-full border-[3px] border-[#17202a] text-3xl font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
            style={{ background: MOSS }}
          >
            87
          </div>
        </motion.div>
      </div>
      <div className="w-full grow space-y-3.5">
        {factors.map((f, i) => (
          <div key={f.label}>
            <div className="flex justify-between text-sm font-bold" style={{ color: STEEL }}>
              <span>{f.label}</span>
              <span className="nums">{f.v}</span>
            </div>
            <div className="mt-1 h-3 rounded-full border-2 border-[#17202a] bg-white">
              <motion.div
                className="h-full rounded-full"
                style={{ background: f.color }}
                initial={{ width: 0 }}
                animate={{ width: `${f.v}%` }}
                transition={{ delay: 0.45 + i * 0.16, type: "spring", bounce: 0.25 }}
              />
            </div>
          </div>
        ))}
        <motion.p {...pop(1.1)} className="pt-1 text-[15px] font-bold" style={{ color: MOSS }}>
          strong fit — interview question pack already drafted
        </motion.p>
      </div>
    </div>
  );
}

/* ── 02 · Voice screening — it speaks Czech too ─────────────────── */
function VoicePreview() {
  const lines = [
    {
      who: "ai" as const,
      text: "Vaše poslední aplikace běžela na Reactu — co se rozbilo jako první, když přišli skuteční uživatelé?"
    },
    { who: "them" as const, text: "Upřímně? Správa stavu. Přepsal jsem ji dvakrát, než jsem pochopil proč…" }
  ];
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.span
            {...pop(0.15)}
            className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#17202a]"
            style={{ background: CORAL }}
          >
            <Mic className="h-4 w-4 text-white" />
          </motion.span>
          <div>
            <p className="text-[15px] font-bold">First-round screen</p>
            <p className="text-sm font-bold" style={{ color: STEEL }}>
              čeština · live · 4 min 12 s
            </p>
          </div>
        </div>
        <span className="flex h-6 items-end gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="voice-eq-bar w-1.5 rounded"
              style={{ height: "100%", background: MOSS, animationDelay: `${d}ms` }}
            />
          ))}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {lines.map((line, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, scale: 0.85, x: line.who === "ai" ? -24 : 24 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ delay: 0.35 + i * 0.3, type: "spring", bounce: 0.4 }}
            className={`max-w-[88%] rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] leading-snug ${
              line.who === "ai" ? "bg-white" : "ml-auto"
            }`}
            style={line.who === "ai" ? undefined : { background: LIMEWASH }}
          >
            {line.text}
          </motion.p>
        ))}
      </div>
      <motion.div
        {...pop(1.1)}
        className="mt-4 flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-4 py-2.5 text-sm font-bold text-white shadow-[3px_3px_0_#17202a]"
        style={{ background: MOSS }}
      >
        <Check className="h-4 w-4" />
        Scorecard drafted on hang-up — coachability, depth, communication
      </motion.div>
    </div>
  );
}

/* ── 03 · Self-scheduling — slots deal themselves out ───────────── */
function SchedulePreview() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return (
    <div>
      <p className="text-[15px] font-bold">Pick a time that suits you</p>
      <p className="text-sm font-bold" style={{ color: STEEL }}>
        Technical interview · 45 min · with Marta
      </p>
      <div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm font-bold">
        {days.map((d) => (
          <span key={d} style={{ color: STEEL }}>
            {d}
          </span>
        ))}
        {days.map((d, col) =>
          [0, 1].map((row) => {
            const picked = col === 2 && row === 1;
            return (
              <motion.span
                key={`${d}-${row}`}
                initial={{ opacity: 0, scale: 0.5, rotate: picked ? -8 : 0 }}
                animate={{ opacity: 1, scale: picked ? 1.08 : 1, rotate: 0 }}
                transition={{ delay: 0.2 + (col * 2 + row) * 0.06, type: "spring", bounce: 0.45 }}
                className="nums relative rounded-lg border-2 border-[#17202a] px-1 py-2"
                style={picked ? { background: MOSS, color: "#fff" } : { background: "#fff" }}
              >
                {row === 0 ? "9:30" : "14:00"}
                {picked && (
                  <motion.span {...pop(1.0)} className="absolute -right-2 -top-2" aria-hidden>
                    <Sparkles className="h-4 w-4" style={{ color: AMBER }} />
                  </motion.span>
                )}
              </motion.span>
            );
          })
        )}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16, rotate: -2 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ delay: 1.1, type: "spring", bounce: 0.4 }}
        className="mt-4 flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-4 py-2.5 text-sm font-bold text-white shadow-[3px_3px_0_#17202a]"
        style={{ background: MOSS }}
      >
        <Check className="h-4 w-4" />
        Confirmed — Wednesday 14:00. Invites sent both ways.
      </motion.div>
    </div>
  );
}

/* ── 04 · One inbox, five doors — channels fly home ─────────────── */
function InboxPreview() {
  const channels = [
    { label: "Apply portal", icon: MousePointerClick },
    { label: "Email", icon: Mail },
    { label: "Job boards", icon: Newspaper },
    { label: "Sourcing", icon: Search },
    { label: "Manual add", icon: PenLine }
  ];
  return (
    <div className="text-center">
      <div className="flex flex-wrap justify-center gap-2.5">
        {channels.map((c, i) => (
          <motion.span
            key={c.label}
            initial={{ opacity: 0, x: i % 2 === 0 ? -70 : 70, rotate: i % 2 === 0 ? -10 : 10 }}
            animate={{ opacity: 1, x: 0, rotate: i % 2 === 0 ? -1.5 : 1.5 }}
            transition={{ delay: 0.15 + i * 0.1, type: "spring", bounce: 0.4 }}
            className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3.5 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            <c.icon className="h-3.5 w-3.5" style={{ color: CORAL }} />
            {c.label}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ delay: 0.75, duration: 0.3 }}
        className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full"
        style={{ background: INK }}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.95, type: "spring", bounce: 0.5 }}
        className="relative mx-auto inline-flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] px-6 py-4 shadow-[5px_5px_0_#17202a]"
        style={{ background: LIMEWASH }}
      >
        <Inbox className="h-6 w-6" />
        <span className={`${DISPLAY} text-lg font-bold`}>One pipeline</span>
        <motion.span
          {...stamp(1.35)}
          className={`${DISPLAY} absolute -right-4 -top-4 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: CORAL }}
        >
          47
        </motion.span>
      </motion.div>
      <motion.p {...pop(1.5)} className="mt-4 text-[15px] font-bold" style={{ color: STEEL }}>
        Every door lands at the same starting line — no source gets a shortcut.
      </motion.p>
    </div>
  );
}

/* ── 05 · Salary radar — the needle finds the market ────────────── */
function SalaryPreview() {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm font-bold" style={{ color: STEEL }}>
        <span>React Developer · mid · Prague</span>
        <span className="nums">CZK / month</span>
      </div>
      <div className="relative mt-8">
        <div className="h-4 rounded-full border-[3px] border-[#17202a] bg-white" />
        <motion.div
          className="absolute inset-y-[3px] rounded-full"
          style={{ background: LIMEWASH, left: "3px", right: "3px" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        />
        <motion.div
          className="absolute inset-y-[3px] rounded-full"
          style={{ background: MOSS, left: "41%" }}
          initial={{ width: 0 }}
          animate={{ width: "34%" }}
          transition={{ delay: 0.35, type: "spring", bounce: 0.25 }}
        />
        <motion.span
          initial={{ left: "8%", opacity: 0 }}
          animate={{ left: "58%", opacity: 1 }}
          transition={{ delay: 0.7, type: "spring", bounce: 0.55 }}
          className="absolute -top-7 -translate-x-1/2"
        >
          <span
            className={`${DISPLAY} nums rounded-lg border-[3px] border-[#17202a] px-2 py-0.5 text-[15px] font-extrabold text-white shadow-[2px_2px_0_#17202a]`}
            style={{ background: CORAL }}
          >
            95k
          </span>
          <span
            className="mx-auto mt-0.5 block h-3 w-1 rounded-full"
            style={{ background: INK }}
            aria-hidden
          />
        </motion.span>
        <div className="nums mt-2 flex justify-between text-sm font-bold" style={{ color: STEEL }}>
          <span>60k</span>
          <span>120k</span>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2.5">
        {[
          ["band 85–105k", MOSS],
          ["market median 95k", CORAL],
          ["scale-up modifier ×1.1", AMBER]
        ].map(([label, color], i) => (
          <motion.span
            key={label}
            {...pop(0.9 + i * 0.12)}
            className="rounded-full border-[3px] border-[#17202a] px-3.5 py-1.5 text-sm font-bold text-white shadow-[2px_2px_0_#17202a]"
            style={{ background: color }}
          >
            {label}
          </motion.span>
        ))}
      </div>
      <motion.p {...pop(1.35)} className="mt-4 text-[15px] font-bold" style={{ color: STEEL }}>
        Grounded in live Czech market data — so the offer lands the first time.
      </motion.p>
    </div>
  );
}

/* ── 06 · Gates & receipts — cards dealt, human signs ───────────── */
function GatesPreview() {
  const queue = [
    { title: "Advance Jana N. to interview", sub: "Fit 87 · strong React depth, gap in testing", color: MOSS },
    { title: "Send kind pass to Alex T.", sub: "Fit 31 · sales-leaning profile, redirect suggested", color: CORAL },
    { title: "Approve offer draft for Petr K.", sub: "Band 85–105k · sits at market median", color: AMBER }
  ];
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold">Waiting on you · 3</p>
        <motion.span
          {...stamp(0.2)}
          className="rounded-full border-[3px] border-[#17202a] px-3 py-1 text-sm font-extrabold uppercase tracking-wide text-white shadow-[2px_2px_0_#17202a]"
          style={{ background: CORAL }}
        >
          human gate
        </motion.span>
      </div>
      <div className="mt-4 space-y-3">
        {queue.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 26, rotate: i % 2 === 0 ? -3 : 3 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.35 + i * 0.16, type: "spring", bounce: 0.4 }}
            className="rounded-xl border-[3px] border-[#17202a] bg-white p-3.5 shadow-[3px_3px_0_#17202a]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold">{item.title}</p>
                <p className="mt-0.5 text-sm font-bold leading-relaxed" style={{ color: STEEL }}>
                  {item.sub}
                </p>
              </div>
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-[#17202a]" style={{ background: item.color }} />
            </div>
            <div className="mt-2.5 flex gap-2 text-sm font-bold">
              <span className="rounded-lg border-2 border-[#17202a] px-3 py-1 text-white" style={{ background: INK }}>
                Approve
              </span>
              <span className="rounded-lg border-2 border-[#17202a] bg-white px-3 py-1">Override</span>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(1.0)} className={`${HAND} mt-4 -rotate-1 text-base`} style={{ color: MOSS }}>
        14:02 — shortlist approved, signed M. Horáková ✓
      </motion.p>
    </div>
  );
}

/* ── 03 · Verified work-sample cases — the authorship receipt ────── */
function CasesPreview() {
  // The differentiator, drawn honestly: the point is NOT "we detect AI", it is that the
  // case ASSUMES the code is AI-written and grades the judgment around it, with
  // mechanical checks that have known ground truth.
  const checks = [
    { label: "Planted flaw in the seed", verdict: "caught & fixed", color: MOSS },
    { label: "Second planted flaw", verdict: "shipped untouched", color: CORAL },
    { label: "Distance from a bare one-shot", verdict: "0.38 — own work visible", color: MOSS }
  ];
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold">Take-home · authorship checks</p>
        <motion.span
          {...stamp(0.2)}
          className="rounded-full border-[3px] border-[#17202a] px-3 py-1 text-sm font-extrabold uppercase tracking-wide text-white shadow-[2px_2px_0_#17202a]"
          style={{ background: MOSS }}
        >
          AI allowed
        </motion.span>
      </div>
      <div className="mt-4 space-y-3">
        {checks.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.14, type: "spring", bounce: 0.4 }}
            className="flex items-center justify-between gap-3 rounded-xl border-[3px] border-[#17202a] bg-white p-3 shadow-[3px_3px_0_#17202a]"
          >
            <p className="text-[15px] font-semibold">{c.label}</p>
            <span className="whitespace-nowrap text-sm font-extrabold" style={{ color: c.color }}>
              {c.verdict}
            </span>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(0.75)} className={`${HAND} mt-4 text-base`} style={{ color: STEEL }}>
        Then the interview asks them to defend the two decisions they actually made.
      </motion.p>
    </div>
  );
}

/* ── 07 · Talent rediscovery — the pool you already paid for ─────── */
function RediscoverPreview() {
  const hits = [
    { name: "Marek D.", why: "Applied 8 months ago · now matches 91", color: MOSS },
    { name: "Lucie H.", why: "Silver medallist, Backend II · matches 84", color: AMBER }
  ];
  return (
    <div>
      <p className="text-[15px] font-bold">New role opened · 2 people you already know</p>
      <div className="mt-4 space-y-3">
        {hits.map((h, i) => (
          <motion.div
            key={h.name}
            {...pop(0.3 + i * 0.16)}
            className="rounded-xl border-[3px] border-[#17202a] bg-white p-3.5 shadow-[3px_3px_0_#17202a]"
          >
            <p className="text-[15px] font-bold">{h.name}</p>
            <p className="text-sm font-semibold" style={{ color: h.why.includes("91") ? MOSS : AMBER }}>
              {h.why}
            </p>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(0.7)} className={`${HAND} mt-4 text-base`} style={{ color: STEEL }}>
        No new sourcing spend — and they already said yes to you once.
      </motion.p>
    </div>
  );
}

/* ── 08 · Offer to onboarded — the last mile ─────────────────────── */
function OfferPreview() {
  const steps = [
    { label: "Offer figure", detail: "band × fit · no model in the number", done: true },
    { label: "Letter drafted, human signs", detail: "sent as a secure link", done: true },
    { label: "Accepted", detail: "candidate flips to Hired", done: true },
    { label: "Onboarding fired", detail: "checklist + pre-boarding form", done: false }
  ];
  return (
    <div>
      <p className="text-[15px] font-bold">Petr K. · offer → day one</p>
      <div className="mt-4 space-y-2.5">
        {steps.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28 + i * 0.13, type: "spring", bounce: 0.4 }}
            className="flex items-center gap-3 rounded-xl border-[3px] border-[#17202a] bg-white p-3 shadow-[3px_3px_0_#17202a]"
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
              style={{ background: s.done ? MOSS : AMBER }}
            >
              <Check className="h-3.5 w-3.5 text-white" />
            </span>
            <div>
              <p className="text-[15px] font-bold">{s.label}</p>
              <p className="text-sm" style={{ color: STEEL }}>
                {s.detail}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ── Registry + spotlight modal ─────────────────────────────────── */
type PreviewDef = {
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  Body: ComponentType;
};

// Title + note now come from the `landing` i18n namespace (features.<key>.title
// and previews.<key>.note); the registry only wires each key to its icon and
// animated body. (The body internals are illustrative product mockups — and the
// voice demo is deliberately Czech — so they stay as authored.)
export const PREVIEWS: Record<PreviewKey, PreviewDef> = {
  score: { icon: FileSearch, Body: ScorePreview },
  voice: { icon: Mic, Body: VoicePreview },
  cases: { icon: FlaskConical, Body: CasesPreview },
  schedule: { icon: Check, Body: SchedulePreview },
  inbox: { icon: Inbox, Body: InboxPreview },
  salary: { icon: Gauge, Body: SalaryPreview },
  rediscover: { icon: History, Body: RediscoverPreview },
  offer: { icon: FileSignature, Body: OfferPreview },
  gates: { icon: ShieldCheck, Body: GatesPreview }
};

export function FeatureSpotlight({
  preview,
  pinned,
  onClose
}: {
  preview: PreviewKey | null;
  pinned: boolean;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const t = useTranslations("landing");
  const def = preview ? PREVIEWS[preview] : null;
  return (
    <AnimatePresence>
      {def && preview && (
        <motion.div
          key="spotlight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={`fixed inset-0 z-[60] grid place-items-center p-4 sm:p-8 ${pinned ? "" : "pointer-events-none"}`}
        >
          <div
            className="absolute inset-0 bg-[#17202a]/45"
            onClick={pinned ? onClose : undefined}
            aria-hidden
          />
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.65, rotate: -5, y: 48 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -1, y: 0 }}
            transition={{ type: "spring", bounce: 0.42, duration: 0.55 }}
            role="dialog"
            aria-modal={pinned}
            aria-label={t(`features.${preview}.title`)}
            className={`relative w-full max-w-xl rounded-2xl border-[3px] border-[#17202a] p-6 shadow-[10px_10px_0_#17202a] sm:p-7`}
            style={{ background: CREAM }}
          >
            <div className="flex items-center justify-between gap-3 border-b-[3px] border-dashed pb-4" style={{ borderColor: LIMEWASH }}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl border-[3px] border-[#17202a] bg-white shadow-[3px_3px_0_#17202a]">
                  <def.icon className="h-5 w-5" style={{ color: CORAL }} />
                </span>
                <h3 className={`${DISPLAY} text-xl font-bold`}>{t(`features.${preview}.title`)}</h3>
              </div>
              {pinned && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("previews.close")}
                  className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#17202a] bg-white shadow-[2px_2px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#17202a]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Keyed remount → every peek replays the choreography. */}
            <div className="pt-5" key={preview}>
              <def.Body />
            </div>
            <p className={`${HAND} mt-5 rotate-1 text-right text-base`} style={{ color: STEEL }}>
              {t(`previews.${preview}.note`)}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
