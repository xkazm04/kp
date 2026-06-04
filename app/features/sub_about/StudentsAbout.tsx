"use client";

import { useState } from "react";
import { Lightbulb, MessageCircleQuestion } from "lucide-react";
import { Markdown } from "../../_components/Markdown";
import { rubricForArchetype } from "@/app/_lib/interview-rubric";
import type { CoverageItem } from "./AboutCoverageData";

// Dedicated About page for the early-career thesis: the selected card's diagram +
// description stay the default tab; two more tabs make the mechanic tangible — a
// worked example of students scored side by side (Decisions-style comparison) and
// the high-level interview script that extracts those signals. Everything here is
// ILLUSTRATIVE (synthetic candidates); the real tables live in Decisions.

const TABS = ["Overview", "Example scoring", "Interview script"] as const;
type Tab = (typeof TABS)[number];

export function StudentsAbout({ item }: { item: CoverageItem }) {
  const [tab, setTab] = useState<Tab>("Overview");
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5">
      <p className="text-meta uppercase text-coral">Early-career students</p>
      <h3 className="mt-1 font-serif text-h2 text-ink">{item.title}</h3>
      <p className="mt-2 text-base leading-7 text-steel">{item.lead}</p>

      <div role="tablist" aria-label="Early-career views" className="mt-4 flex gap-1 rounded-lg border border-stone-200 bg-paper p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`focus-ring flex-1 rounded-md px-3 py-1.5 text-base font-medium transition-colors ${
              tab === t ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "Overview" ? (
          <Markdown content={item.body} />
        ) : tab === "Example scoring" ? (
          <ExampleScoring />
        ) : (
          <InterviewScript />
        )}
      </div>
    </article>
  );
}

// ---- Tab 2: worked example — three students side by side --------------------

type AxisKey = "skills" | "potential" | "motivation";
const AXES: { key: AxisKey; label: string; sub: string }[] = [
  { key: "skills", label: "Demonstrated skill", sub: "provenance-weighted match" },
  { key: "potential", label: "Potential", sub: "depth · velocity · foundation · initiative" },
  { key: "motivation", label: "Motivation & fit", sub: "direction · domain fit" },
];

type ExampleStudent = {
  name: string;
  tagline: string;
  weights: Record<AxisKey, number>; // % — bounded dynamic weights
  scores: Record<AxisKey, number>; // 0-100 per axis
  total: number;
  band: [number, number];
  bandLevel: "tight" | "moderate" | "wide";
  bandWhy: string;
  weightWhy: string;
  // Interview grid, keyed by the EXACT rubric competency names (1-5 + quote).
  ratings: Record<string, { score: number; evidence: string }>;
};

const STUDENTS: ExampleStudent[] = [
  {
    name: "Adéla",
    tagline: "Part-time backend job + passed live case → observed evidence",
    weights: { skills: 48, potential: 34, motivation: 18 },
    scores: { skills: 82, potential: 68, motivation: 71 },
    total: 75,
    band: [69, 81],
    bandLevel: "moderate",
    bandWhy: "Early-career, but two skills were directly observed (live case) — band stays tighter.",
    weightWhy: "Must-haves backed by observed + professional evidence → demonstrated skill weighted up (bounded).",
    ratings: {
      "Problem decomposition": { score: 4, evidence: "Split the task into ingestion, validation and API before touching code." },
      "Learning agility": { score: 4, evidence: "\"I benchmarked both, saw the N+1, and rewrote the loader.\"" },
      Coachability: { score: 5, evidence: "Took the indexing hint and generalised it to the cache layer unprompted." },
      "Conceptual depth": { score: 4, evidence: "Explained WHY the queue decouples the spike, not just that it does." },
      "Motivation & direction": { score: 3, evidence: "Backend interest is real but the long-term goal is still fuzzy." },
      "Communication & collaboration": { score: 4, evidence: "Checked understanding before answering the counterfactual." },
    },
  },
  {
    name: "Bára",
    tagline: "Thesis + projects, no work yet → strong potential, thin proof",
    weights: { skills: 32, potential: 50, motivation: 18 },
    scores: { skills: 58, potential: 81, motivation: 74 },
    total: 72,
    band: [62, 82],
    bandLevel: "wide",
    bandWhy: "Early-career with no observed evidence yet — thinner, less-verifiable track record.",
    weightWhy: "No high-trust skill evidence yet — the case rests on trajectory, so potential carries the weight.",
    ratings: {
      "Problem decomposition": { score: 4, evidence: "Named the constraints first, then ordered sub-problems by risk." },
      "Learning agility": { score: 5, evidence: "Described a diagnose–experiment–adjust loop from the thesis dead-end." },
      Coachability: { score: 3, evidence: "Adjusted after the hint, but needed a second prompt to act on it." },
      "Conceptual depth": { score: 4, evidence: "Handled the 100× counterfactual; flagged where the design breaks." },
      "Motivation & direction": { score: 4, evidence: "Coherent throughline from coursework choices to this role." },
      "Communication & collaboration": { score: 3, evidence: "Clear but long-winded; structure appeared only when asked." },
    },
  },
  {
    name: "Cyril",
    tagline: "Long self-declared skill list, weak interview verification",
    weights: { skills: 40, potential: 40, motivation: 20 },
    scores: { skills: 49, potential: 52, motivation: 60 },
    total: 52,
    band: [42, 62],
    bandLevel: "wide",
    bandWhy: "Thin verification + overclaim risk — treat the score as provisional.",
    weightWhy: "Baseline weights — nothing verified enough to justify a shift; overclaim risk routed to interview.",
    ratings: {
      "Problem decomposition": { score: 2, evidence: "Jumped to a memorised pattern; missed the stated constraint." },
      "Learning agility": { score: 2, evidence: "\"It just worked after a while\" — no repeatable loop described." },
      Coachability: { score: 2, evidence: "Acknowledged the hint, then repeated the original approach." },
      "Conceptual depth": { score: 3, evidence: "Happy path explained; tradeoffs broke down on the first what-if." },
      "Motivation & direction": { score: 3, evidence: "Interest stated, but not tied to anything he has built." },
      "Communication & collaboration": { score: 3, evidence: "Pleasant and fluent — fluency scored separately from content." },
    },
  },
];

const BAND_STYLE: Record<ExampleStudent["bandLevel"], string> = {
  tight: "text-moss",
  moderate: "text-steel",
  wide: "text-dial-amber",
};

const ratingColor = (r: number) =>
  r >= 4 ? "bg-moss/15 text-moss" : r <= 2 ? "bg-coral/10 text-coral" : "bg-stone-100 text-ink";

function ExampleScoring() {
  // The interview grid rows come from the REAL early-career rubric (the same JSON
  // the Python scorer reads) — only the candidates here are synthetic.
  const rubric = rubricForArchetype("student");

  return (
    <div>
      <p className="text-base text-steel">
        Three illustrative students against one junior backend role. Each carries a <em>bounded</em>,
        evidence-driven weighting — the axes are the same, how much each counts is earned. The real
        version of this table lives in Decisions → Group evaluation.
      </p>

      <p className="mt-4 text-meta uppercase tracking-wide text-steel">Weighted dimensions</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">Dimension</th>
              {STUDENTS.map((s) => (
                <th key={s.name} className="min-w-[170px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="mt-0.5 text-sm font-normal text-steel">{s.tagline}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXES.map((axis) => (
              <tr key={axis.key} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 align-top">
                  <p className="text-ink">{axis.label}</p>
                  <p className="text-meta text-steel">{axis.sub}</p>
                </td>
                {STUDENTS.map((s) => (
                  <td key={s.name} className="p-2 align-top">
                    <span className="font-semibold nums text-ink">{s.scores[axis.key]}</span>
                    <span className="ml-1.5 text-meta text-steel nums">
                      w {s.weights[axis.key]}% · +{((s.scores[axis.key] * s.weights[axis.key]) / 100).toFixed(1)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-stone-200">
              <td className="sticky left-0 bg-white p-2 font-semibold text-ink">Total</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2">
                  <span className="inline-flex h-7 min-w-9 items-center justify-center rounded-md bg-stone-100 px-1.5 font-semibold nums text-ink">
                    {s.total}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="sticky left-0 bg-white p-2 text-ink">Confidence band</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2" title={s.bandWhy}>
                  <span className={`text-sm font-medium nums ${BAND_STYLE[s.bandLevel]}`}>
                    {s.band[0]}–{s.band[1]} · {s.bandLevel}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="sticky left-0 bg-white p-2 text-ink">Why this weighting</td>
              {STUDENTS.map((s) => (
                <td key={s.name} className="p-2 align-top">
                  <p className="text-sm text-steel">{s.weightWhy}</p>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-meta uppercase tracking-wide text-steel">Interview rubric · 1–5 with quoted evidence</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">Construct</th>
              {STUDENTS.map((s) => (
                <th key={s.name} className="min-w-[100px] p-2 text-left text-ink">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rubric.map((comp) => (
              <tr key={comp.competency} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 text-ink" title={comp.description}>
                  {comp.competency}
                </td>
                {STUDENTS.map((s) => {
                  const r = s.ratings[comp.competency];
                  return (
                    <td key={s.name} className="p-2">
                      {r ? (
                        <span
                          className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${ratingColor(r.score)}`}
                          title={r.evidence}
                        >
                          {r.score}
                        </span>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-steel">
        Hover a rating for the verbatim evidence behind it — no quote, no score. Adéla&apos;s observed live case
        narrows her band; Bára outscores her on potential but stays wide until something is observed; Cyril&apos;s
        fluent delivery is scored separately from the content of his reasoning.
      </p>
    </div>
  );
}

// ---- Tab 3: the interview thought-script ------------------------------------

type ScriptPhase = {
  phase: string;
  minutes: string;
  goal: string;
  probe: string;
  listenFor: string;
  feeds: string[]; // rubric competency names
};

const SCRIPT: ScriptPhase[] = [
  {
    phase: "Anchor on their ground",
    minutes: "3–4 min",
    goal: "Start where they are strongest — their own project — to get a truthful baseline, not a rehearsed pitch.",
    probe: "“Walk me through the project you're proudest of. What exactly was yours?”",
    listenFor: "Ownership language (“I decided” vs “we were told”); specifics over buzzwords.",
    feeds: ["Communication & collaboration", "Motivation & direction"],
  },
  {
    phase: "Mechanism probes",
    minutes: "4–5 min",
    goal: "Move from what they built to WHY it works — the difference between understanding and recall.",
    probe: "“Why X over Y? What breaks first if we remove Z?”",
    listenFor: "Causal reasoning about their own choices; honest “I don't know” over confabulation.",
    feeds: ["Conceptual depth", "Problem decomposition"],
  },
  {
    phase: "Counterfactual & transfer",
    minutes: "4–5 min",
    goal: "Change one constraint and watch whether the knowledge generalises or was memorised.",
    probe: "“Same system, but the data is 100× bigger — what changes first?”",
    listenFor: "Re-decomposition under the new constraint, not a recited pattern.",
    feeds: ["Conceptual depth", "Problem decomposition"],
  },
  {
    phase: "Coachability injection",
    minutes: "3–4 min",
    goal: "Deliberately offer a hint or gentle pushback mid-problem — the one signal no take-home can capture.",
    probe: "“Have you considered the case where the input arrives out of order?”",
    listenFor: "Hint uptake: integrate and build on it (5) vs acknowledge and ignore (2). Score the uptake, not the answer.",
    feeds: ["Coachability", "Learning agility"],
  },
  {
    phase: "Stuck-and-recovered",
    minutes: "3–4 min",
    goal: "Surface the learning loop — how they behave when nothing works is the best ramp-up predictor we have.",
    probe: "“Where did you get hardest stuck? Walk me through getting out.”",
    listenFor: "A repeatable diagnose–experiment–adjust loop; reflection on what they'd do differently.",
    feeds: ["Learning agility"],
  },
  {
    phase: "Calibration & direction",
    minutes: "3–4 min",
    goal: "Test self-awareness: have them rate themselves, then probe the rating; close on where they want to go.",
    probe: "“Rate your SQL 1–10. What would someone one point above you know that you don't?”",
    listenFor: "Calibrated self-assessment (knowing the shape of what they don't know); intrinsic, specific direction.",
    feeds: ["Motivation & direction", "Coachability"],
  },
];

function InterviewScript() {
  return (
    <div>
      <p className="text-base text-steel">
        The high-level thought-script the agentic interviewer follows (~20–25 minutes). The order is
        deliberate — concrete → mechanism → counterfactual → metacognitive — and the agent may improvise
        follow-ups, but it must leave with a scoreable, <em>quotable</em> observation for every rubric
        construct before closing. Hints are injected on purpose: coachability only exists live.
      </p>

      <ol className="mt-4 space-y-3">
        {SCRIPT.map((p, i) => (
          <li key={p.phase} className="rounded-lg border border-stone-200 bg-paper/40 p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral/10 text-sm font-semibold nums text-coral">
                {i + 1}
              </span>
              <p className="font-medium text-ink">{p.phase}</p>
              <span className="text-meta text-steel nums">{p.minutes}</span>
            </div>
            <p className="mt-1.5 text-sm text-steel">{p.goal}</p>
            <p className="mt-2 flex items-start gap-1.5 text-sm text-ink">
              <MessageCircleQuestion size={15} className="mt-0.5 shrink-0 text-coral" aria-hidden />
              <span className="italic">{p.probe}</span>
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-steel">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-dial-amber" aria-hidden />
              <span>
                <span className="font-medium text-ink">Listen for:</span> {p.listenFor}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.feeds.map((f) => (
                <span key={f} className="rounded-full bg-stone-100 px-2 py-0.5 text-meta font-medium text-steel">
                  {f}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-sm text-steel">
        Every rating must cite a verbatim transcript quote (no quote, no score), a short or evasive answer
        widens the confidence band instead of lowering the score, and reasoning content is scored separately
        from delivery fluency — nerves and non-native English are not weak thinking.
      </p>
    </div>
  );
}
