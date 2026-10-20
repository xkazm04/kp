import type { Gig, GigPlan } from "../types";
import { gigFreelancerIntro } from "../freelancer-profile";

// The client proposal's BODY (the proposal track, docs/features/gigs/README.md "Two tracks"):
// plain-text fields the page template escapes and lays out. Two writers fill it - the pinned
// model (gig_proposal_cli.py, validated again here by parseGigProposalBody) and kp itself
// (deterministicProposal: keyless, a failed or unusable call, a suspect gig) - and both pass
// the same honesty gate: a sentence naming a money figure the listing's own reward text does
// not state is dropped, and the message always ENDS with the AI-use disclosure. Pure.

export type GigProposalBody = {
  title: string;
  understanding: string;
  approach: string[];
  milestones: { title: string; delivers: string }[];
  timeline: string;
  effort: { minHours: number; maxHours: number } | null;
  questions: string[];
  artifacts: string[];
  /** The bid to paste into the platform, <= GIG_PROPOSAL_MESSAGE_MAX, disclosure last. */
  message: string;
};

/** Mirrors gig_proposal_cli.py MAX_MESSAGE_CHARS / CAPS / MAX_ITEMS. */
export const GIG_PROPOSAL_MESSAGE_MAX = 1500;
const CAP = { title: 140, understanding: 900, item: 300, timeline: 400, artifact: 200, milestone: 160 } as const;
const MOST = { approach: 6, milestones: 9, questions: 8, artifacts: 8 } as const;

const CODES = "USD|EUR|GBP|CZK|CHF|PLN|INR|AUD|CAD|Kč|dollars?|euros?";
// A currency code is a whole word; JS `\b` is ASCII-only, so "Kč" is bounded by Unicode
// look-arounds instead.
const CODE = `(?<![\\p{L}\\p{N}_])(?:${CODES})(?![\\p{L}\\p{N}_])`;
const MONEY = new RegExp(`(?:[$€£¥]|${CODE})\\s?\\d[\\d,.\\s]*\\d|(?:[$€£¥]|${CODE})\\s?\\d|\\d[\\d,.]*\\s?(?:[$€£¥]|${CODE}|,-)`, "giu");
const SENTENCE_BREAK = /(?<=[.!?])\s+/;

/** The money figures (digits only) the listing's reward text states. Pure. */
export function allowedMoneyFigures(rewardText: string | null | undefined): Set<string> {
  if (!rewardText) return new Set();
  return new Set([...rewardText.matchAll(/\d[\d,.\s]*\d|\d/g)].map((m) => m[0].replace(/\D/g, "")));
}

function inventsMoney(text: string, allowed: ReadonlySet<string>): boolean {
  return [...text.matchAll(MONEY)].some((m) => !allowed.has(m[0].replace(/\D/g, "")));
}

/** The text with every sentence that names an unbacked money figure removed, line by line. */
export function honestText(text: string, allowed: ReadonlySet<string>): string {
  const lines = text.split("\n").map((line) => {
    const parts = line.split(SENTENCE_BREAK);
    const kept = parts.filter((s) => !inventsMoney(s, allowed));
    return kept.length === parts.length ? line.trimEnd() : kept.join(" ").trim();
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clip(s: string, cap: number): string {
  return s.length <= cap ? s : `${s.slice(0, cap - 1)}…`;
}

function line(v: unknown, cap: number, allowed: ReadonlySet<string>): string | null {
  if (typeof v !== "string") return null;
  const s = honestText(v.replace(/\s+/g, " ").trim(), allowed);
  return s ? clip(s, cap) : null;
}

function lines(v: unknown, cap: number, most: number, allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    const s = line(item, cap, allowed);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= most) break;
  }
  return out;
}

/** The message ending with the disclosure (once), within the message cap. Pure. */
export function withDisclosure(message: string, disclosure: string): string {
  let body = message.split(disclosure).join("").trim();
  const room = GIG_PROPOSAL_MESSAGE_MAX - disclosure.length - 2;
  if (body.length > room) body = `${body.slice(0, room - 1).trimEnd()}…`;
  return body ? `${body}\n\n${disclosure}` : disclosure;
}

function effortOf(v: unknown): GigProposalBody["effort"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { minHours: lo, maxHours: hi } = v as Record<string, unknown>;
  if (typeof lo !== "number" || typeof hi !== "number" || !(lo > 0 && hi >= lo && hi <= 2000)) return null;
  return { minHours: Math.round(lo * 10) / 10, maxHours: Math.round(hi * 10) / 10 };
}

/** The model's `result` as a body kp trusts, or null when it is unusable (no understanding,
 *  no approach, no message beyond the disclosure). `fallbackTitle` stands in for a missing
 *  title (the listing's own). Pure. */
export function parseGigProposalBody(raw: unknown, opts: { rewardText: string | null; disclosure: string; fallbackTitle: string }): GigProposalBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const allowed = allowedMoneyFigures(opts.rewardText);
  const understanding = line(r.understanding, CAP.understanding, allowed);
  const approach = lines(r.approach, CAP.item, MOST.approach, allowed);
  const message = typeof r.message === "string" ? honestText(r.message.replace(/[ \t\r\f\v]+/g, " ").trim(), allowed) : "";
  if (!understanding || approach.length === 0 || !message.split(opts.disclosure).join("").trim()) return null;
  const milestones: GigProposalBody["milestones"] = [];
  for (const m of Array.isArray(r.milestones) ? r.milestones : []) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const t = line((m as Record<string, unknown>).title, CAP.milestone, allowed);
    const d = line((m as Record<string, unknown>).delivers, CAP.item, allowed);
    if (t && d) milestones.push({ title: t, delivers: d });
    if (milestones.length >= MOST.milestones) break;
  }
  return {
    title: line(r.title, CAP.title, allowed) ?? clip(opts.fallbackTitle, CAP.title),
    understanding,
    approach,
    milestones,
    timeline: line(r.timeline, CAP.timeline, allowed) ?? "",
    effort: effortOf(r.effort),
    questions: lines(r.questions, CAP.item, MOST.questions, allowed),
    artifacts: lines(r.artifacts, CAP.artifact, MOST.artifacts, allowed),
    message: withDisclosure(message, opts.disclosure),
  };
}

/** The first `n` sentences of `text`. Pure. */
export function firstSentences(text: string, n: number): string {
  return text.replace(/\s+/g, " ").trim().split(SENTENCE_BREAK).slice(0, n).join(" ");
}

/** What the gig is, from the brief: the first paragraph under its first heading (the brief
 *  opens with "What the gig is"), else its first paragraph. Pure. */
function briefGist(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block
      .split("\n")
      .filter((l) => !/^\s*#/.test(l) && !/^\s*(?:[-*]|\d+[.)])\s/.test(l))
      .join(" ")
      .trim();
    if (text) return firstSentences(text, 3);
  }
  return "";
}

/** kp's own proposal, from the brief and the accepted plan (null = brief only). No sentence
 *  here is a claim kp cannot back: the understanding and the asks are the brief's, the
 *  milestones and questions the accepted plan's, the message the brief's outreach message.
 *  Written in English (the brief is English). Pure. */
export function deterministicProposal(gig: Pick<Gig, "title" | "brief" | "reward">, plan: GigPlan | null, disclosure: string): GigProposalBody {
  const brief = gig.brief;
  const allowed = allowedMoneyFigures(gig.reward?.text);
  const gist = brief ? briefGist(brief.markdown) : "";
  const understanding = gist || `You are looking for help with: ${gig.title}.`;
  const approach = plan
    ? [firstSentences(plan.summary, 2), ...plan.decisions].filter(Boolean)
    : ["I would start by confirming the requirements and the open questions below, then send a detailed plan with milestones."];
  const effort = plan?.effortHours ? { minHours: plan.effortHours.min, maxHours: plan.effortHours.max } : brief?.effort ? { minHours: brief.effort.minHours, maxHours: brief.effort.maxHours } : null;
  const artifacts = brief?.missingArtifacts ?? [];
  // The bid's shape (gig_proposal_cli.py "message"): interest, the plan as steps, what the work needs to START
  // once agreed (nothing is asked for now), a closing line. The brief's own message follows the same rules.
  const steps = (plan?.steps ?? []).slice(0, 5).map((s) => `- ${s.title}`);
  const opening =
    brief?.outreachMessage?.trim() ||
    [
      `Hello, I am ${gigFreelancerIntro()}, and the scope below is feasible and quick to deliver.`,
      ...(steps.length ? [``, `How I would approach it:`, ...steps] : []),
      ...(artifacts.length ? [``, `To get started once we agree, I would need:`, ...artifacts.map((a) => `- ${a}`)] : []),
      ``,
      `I am happy to adapt the plan to how you work. Just reply here.`,
    ].join("\n");
  const raw = {
    title: gig.title,
    understanding,
    approach,
    milestones: (plan?.steps ?? []).map((s) => ({ title: s.title, delivers: s.doneWhen })),
    timeline: plan
      ? "The milestones run in the order above; the dates are agreed once the questions below are answered."
      : "A detailed plan with milestones follows your answers to the questions below.",
    effort,
    questions: plan?.questions ?? [],
    artifacts,
    message: opening,
  };
  // The same gate as the model's answer: the brief and the plan are models' text too.
  return (
    parseGigProposalBody(raw, { rewardText: gig.reward?.text ?? null, disclosure, fallbackTitle: gig.title }) ?? {
      ...raw,
      understanding: honestText(understanding, allowed) || `You are looking for help with: ${gig.title}.`,
      approach: approach.length ? approach : ["A detailed plan follows your answers."],
      message: withDisclosure(honestText(opening, allowed), disclosure),
    }
  );
}
