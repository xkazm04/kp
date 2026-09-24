import type { Gig, GigAttempt, GigSource } from "./types";

// The pre-send lint: what a careful reviewer would catch in a specialist's draft before
// the operator sends it under their own account. PURE and client-safe - rows in,
// findings out, the clock passed in - so the Gig desk runs it in the browser on every
// card and the same rules are testable without a DOM (draft-lint.test.ts).
//
// Severity is a contract with the desk, stated once:
//   blocker  Approve stays disabled while it is open. Nothing on the desk lifts it: the
//            fix is a revision, a discard, or a fact changing (a source resumed).
//   warn     Approve stays disabled until the operator marks it seen. Seeing is a
//            judgement ("I read this and it is fine"), not a fix.
//   info     Shown, never gating: a fact about the draft worth knowing (an agent's
//            claim with no run log, a cost never reported).
//
// `line` is the 1-based line of `deliverable.draftText` split on newlines - the line the
// desk anchors the margin mark beside. Null when the finding is about something other
// than a line of the draft (the source, the deadline, an evidence item, a question).
// `messageKey` names a message under the `gigs.lint` catalog namespace; `params` are its
// ICU arguments. `params.excerpt`, when present, is the exact text on that line the
// finding refers to, so the desk can underline it.

export const DRAFT_LINT_SEVERITIES = ["blocker", "warn", "info"] as const;
export type DraftLintSeverity = (typeof DRAFT_LINT_SEVERITIES)[number];

export const DRAFT_LINT_KEYS = [
  "noDeliverable",
  "sourceInvalidStreak",
  "deadlinePassed",
  "evidenceFailed",
  "evidenceNoCommand",
  "doubledWord",
  "rewardMentioned",
  "disclosureAbsent",
  "disclosureNotInDraft",
  "questionOpen",
  "costUnreported",
] as const;
export type DraftLintKey = (typeof DRAFT_LINT_KEYS)[number];

export type DraftLintFinding = {
  /** Stable within one attempt, so a "seen" mark survives a re-render and a reload of
   *  the same rows. */
  id: string;
  severity: DraftLintSeverity;
  line: number | null;
  messageKey: DraftLintKey;
  params: Record<string, string | number>;
};

export type DraftLintInput = {
  gig: Pick<Gig, "reward" | "deadlineAt">;
  attempt: Pick<GigAttempt, "deliverable" | "costUsd">;
  /** The gig's source; null for a forwarded brief (no source) or one not loaded. */
  source: Pick<GigSource, "pausedReason" | "invalidStreak" | "host"> | null;
  now: Date;
};

/** The draft as the desk numbers it. */
export function draftLines(text: string): string[] {
  return text.split(/\r?\n/);
}

const FENCE = /^\s*(```|~~~)/;

/** Which lines sit inside a fenced code block (fence lines included). Code is not
 *  prose: `return return` in a snippet is not a template seam. */
function fencedLines(lines: readonly string[]): boolean[] {
  const out: boolean[] = [];
  let inside = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      out.push(true);
      inside = !inside;
      continue;
    }
    out.push(inside);
  }
  return out;
}

// The same word twice in a row ("the the"), or two articles in a row ("the an") - both
// are the seam a template leaves when a slot is filled twice. Letters only, so "10 10"
// in a table and "go-go" are left alone.
const REPEATED_WORD = /(?<!\p{L})(\p{L}+)\s+\1(?!\p{L})/giu;
const ARTICLE_PAIR = /(?<!\p{L})(the|a|an)\s+(the|a|an)(?!\p{L})/giu;

function doubledWord(line: string): string | null {
  const hits: { index: number; text: string }[] = [];
  for (const rx of [REPEATED_WORD, ARTICLE_PAIR]) {
    rx.lastIndex = 0;
    const m = rx.exec(line);
    if (m) hits.push({ index: m.index, text: m[0] });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[0].text;
}

// Money-shaped text: a currency symbol against a number, an ISO code beside a number,
// or the phrases a draft uses when it talks about a reward it was never told.
const MONEY_PATTERNS: readonly RegExp[] = [
  /[$€£¥]\s?\d[\d,.]*(?:\s?[kK]\b)?/u,
  /\d[\d,.]*\s?(?:USD|EUR|GBP|CZK|USDC|USDT)\b/u,
  /\b(?:USD|EUR|GBP|CZK)\s?\d[\d,.]*/u,
  /\b(?:unstated amount|payout|prize money|the reward|bounty of)\b/iu,
];

function moneyMention(line: string): string | null {
  let best: { index: number; text: string } | null = null;
  for (const rx of MONEY_PATTERNS) {
    const m = rx.exec(line);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, text: m[0] };
  }
  return best ? best.text : null;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/u, "").trim();
}

/** Run every rule. Order is stable: facts outside the draft first, then the draft's
 *  lines top to bottom, then the disclosure, the questions and the cost. */
export function lintDraft(input: DraftLintInput): DraftLintFinding[] {
  const { gig, attempt, source, now } = input;
  const out: DraftLintFinding[] = [];

  if (source && source.pausedReason === "invalid_streak") {
    out.push({
      id: "source:invalid_streak",
      severity: "blocker",
      line: null,
      messageKey: "sourceInvalidStreak",
      params: { streak: source.invalidStreak, host: source.host },
    });
  }

  if (gig.deadlineAt) {
    const t = Date.parse(gig.deadlineAt);
    if (Number.isFinite(t) && t < now.getTime()) {
      out.push({ id: "deadline:passed", severity: "blocker", line: null, messageKey: "deadlinePassed", params: { deadline: gig.deadlineAt } });
    }
  }

  const dl = attempt.deliverable;
  if (!dl) {
    out.push({ id: "deliverable:none", severity: "blocker", line: null, messageKey: "noDeliverable", params: {} });
    if (attempt.costUsd === null) out.push({ id: "cost:unreported", severity: "info", line: null, messageKey: "costUnreported", params: {} });
    return out;
  }

  dl.evidence.forEach((ev, i) => {
    if (ev.passed === false) {
      out.push({ id: `evidence:${i}:failed`, severity: "blocker", line: null, messageKey: "evidenceFailed", params: { n: i + 1, kind: ev.kind } });
    }
    if (ev.command === null || !ev.command.trim()) {
      out.push({ id: `evidence:${i}:nocommand`, severity: "info", line: null, messageKey: "evidenceNoCommand", params: { n: i + 1, kind: ev.kind } });
    }
  });

  const lines = draftLines(dl.draftText);
  const fenced = fencedLines(lines);
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const n = i + 1;
    const dbl = doubledWord(line);
    if (dbl) out.push({ id: `line:${n}:doubled`, severity: "warn", line: n, messageKey: "doubledWord", params: { excerpt: dbl } });
    if (gig.reward === null) {
      const money = moneyMention(line);
      if (money) out.push({ id: `line:${n}:reward`, severity: "warn", line: n, messageKey: "rewardMentioned", params: { excerpt: money } });
    }
  });

  const disclosure = dl.disclosure.trim();
  if (!disclosure) {
    out.push({ id: "disclosure:absent", severity: "blocker", line: null, messageKey: "disclosureAbsent", params: {} });
  } else if (!squash(dl.draftText).includes(squash(disclosure))) {
    out.push({ id: "disclosure:not_in_draft", severity: "warn", line: null, messageKey: "disclosureNotInDraft", params: {} });
  }

  dl.questions.forEach((q, i) => {
    if (!q.trim()) return;
    out.push({ id: `question:${i}`, severity: "warn", line: null, messageKey: "questionOpen", params: { n: i + 1, question: q.trim() } });
  });

  if (attempt.costUsd === null) out.push({ id: "cost:unreported", severity: "info", line: null, messageKey: "costUnreported", params: {} });
  return out;
}

export type DraftLintGate = {
  blockers: number;
  warns: number;
  /** Warns not yet marked seen. */
  unseenWarns: number;
};

/** What still stands between the draft and Approve on the lint side. The checklist is
 *  the desk's other half and is counted there. */
export function lintGate(findings: readonly DraftLintFinding[], seen: ReadonlySet<string>): DraftLintGate {
  let blockers = 0;
  let warns = 0;
  let unseenWarns = 0;
  for (const f of findings) {
    if (f.severity === "blocker") blockers += 1;
    else if (f.severity === "warn") {
      warns += 1;
      if (!seen.has(f.id)) unseenWarns += 1;
    }
  }
  return { blockers, warns, unseenWarns };
}

const SEVERITY_RANK: Readonly<Record<DraftLintSeverity, number>> = { blocker: 0, warn: 1, info: 2 };

/** Blockers, then warns, then info; stable within a severity. */
export function bySeverity(findings: readonly DraftLintFinding[]): DraftLintFinding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}
