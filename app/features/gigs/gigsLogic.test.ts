// Pure logic for the Gigs tab (gigsLogic.ts): which queue a gig sits in, how far along
// the line it got, the rate as a fraction, and the desk's Approve gate.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigAttempt, GigAttemptStatus, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types.ts";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import {
  briefHeadingResolver,
  briefHeadingText,
  canQuickDecline,
  checklistKeyFor,
  deadlineView,
  difficultyBars,
  deskGate,
  evidenceState,
  isTypingTarget,
  markSentGate,
  matchesSearch,
  overallCell,
  queueKindOf,
  rateView,
  reachedStep,
  revealInvisible,
  sourceScanView,
  streakTone,
} from "./gigsLogic.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function gig(id: string, status: GigStatus, p: Partial<Gig> = {}): Gig {
  return {
    id,
    sourceId: null,
    arena: "oss_bounty",
    externalKey: id,
    url: `https://example.test/${id}`,
    title: `Gig ${id}`,
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "body",
    tags: [],
    niche: null,
    status,
    suspectReasons: [],
    specialistId: null,
    qualification: null,
    brief: null,
    workdir: null,
    personasProjectId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...p,
  };
}

function att(id: string, gigId: string, status: GigAttemptStatus, p: Partial<GigAttempt> = {}): GigAttempt {
  return {
    id,
    gigId,
    specialistId: "s1",
    executionId: null,
    status,
    deliverable: null,
    fallbackReason: null,
    costUsd: null,
    review: null,
    revisionNote: null,
    sentAt: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...p,
  };
}

test("queueKindOf: each gig lands in exactly the queue of whoever acts next", () => {
  assert.equal(queueKindOf(gig("a", "suspect"), null), "suspect");
  assert.equal(queueKindOf(gig("a", "sent"), att("x", "a", "sent")), "record");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "drafted")), "review");
  assert.equal(queueKindOf(gig("a", "in_review"), att("x", "a", "approved")), "review");
  assert.equal(queueKindOf(gig("a", "dispatched"), att("x", "a", "running")), "running");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "revision_requested")), "revision");
  assert.equal(queueKindOf(gig("a", "new"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "discarded")), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "failed")), "failed");
  for (const s of ["accepted", "rejected", "declined", "expired", "withdrawn"] as const) {
    assert.equal(queueKindOf(gig("a", s), null), null, `${s} needs nobody`);
  }
});

test("reachedStep separates 'none here now' from 'none reached'", () => {
  const accepted = [gig("x", "accepted")];
  assert.equal(reachedStep(accepted, {}, "drafted"), true, "an accepted gig passed through drafted");
  assert.equal(reachedStep(accepted, {}, "sent"), true);
  assert.equal(reachedStep(accepted, {}, "rejected"), false, "accepted and rejected are alternatives");
  assert.equal(reachedStep(accepted, {}, "suspect"), false, "suspect is a side branch, not a rank");
  const fresh = [gig("n", "new")];
  assert.equal(reachedStep(fresh, {}, "new"), true);
  assert.equal(reachedStep(fresh, {}, "qualified"), false);
  // A declined gig is read off its latest attempt.
  const left = [gig("d", "declined")];
  assert.equal(reachedStep(left, {}, "qualified"), false);
  assert.equal(reachedStep(left, { d: att("a", "d", "sent") }, "sent"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "dispatched"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "drafted"), false);
  assert.equal(reachedStep([gig("c", "new", { suspectReasons: ["agent_addressed"] })], {}, "suspect"), true);
});

test("matchesSearch reads title, org, id, niche and tags", () => {
  const g = gig("gig_7", "new", { title: "Rust CLI bounty", org: "Acme", tags: ["tokio"], niche: "cli" });
  for (const q of ["rust", "ACME", "gig_7", "tokio", "cli", "  "]) assert.equal(matchesSearch(g, q), true, q);
  assert.equal(matchesSearch(g, "python"), false);
});

function cell(p: Partial<GigKpiCell>): GigKpiCell {
  return { resolved: 0, accepted: 0, rate: null, pending: 0, costPerAcceptedUsd: null, costUnreported: 0, smallSample: true, ...p };
}

test("rateView: unmeasured is never 0%; the percent rides only beside its n", () => {
  assert.deepEqual(rateView(cell({ pending: 2 })), { measured: false, accepted: 0, resolved: 0, pending: 2, percent: null, small: true });
  const r = rateView(cell({ resolved: 3, accepted: 1, rate: 1 / 3, pending: 1 }));
  assert.equal(r.percent, 33);
  assert.equal(r.measured, true);
  assert.equal(rateView(null).measured, false);
});

test("overallCell sums the arena partition and re-derives the rate and the small-sample flag", () => {
  const kpi = {
    byArena: {
      security: cell({ resolved: 4, accepted: 1, rate: 0.25, pending: 1, costUnreported: 2 }),
      freelance: cell({ resolved: 6, accepted: 3, rate: 0.5, pending: 0 }),
      competition: cell({}),
      oss_bounty: cell({ pending: 2 }),
    },
  };
  const o = overallCell(kpi);
  assert.equal(o.resolved, 10);
  assert.equal(o.accepted, 4);
  assert.equal(o.pending, 3);
  assert.equal(o.rate, 0.4);
  assert.equal(o.smallSample, false);
  assert.equal(o.costUnreported, 2);
  assert.equal(overallCell({ byArena: { security: cell({}), freelance: cell({}), competition: cell({}), oss_bounty: cell({}) } }).rate, null);
});

test("deadlineView: none, passed, soon (3 days or less), open", () => {
  assert.deepEqual(deadlineView(null, NOW), { state: "none" });
  assert.equal(deadlineView("2026-09-20T00:00:00.000Z", NOW).state, "passed");
  assert.equal(deadlineView("2026-09-26T00:00:00.000Z", NOW).state, "soon");
  assert.equal(deadlineView("2026-10-24T00:00:00.000Z", NOW).state, "open");
  assert.deepEqual(deadlineView("not a date", NOW), { state: "none" });
});

test("evidenceState keeps three states: unverified is not failed", () => {
  assert.equal(evidenceState(true), "passed");
  assert.equal(evidenceState(false), "failed");
  assert.equal(evidenceState(null), "unverified");
});

function finding(id: string, severity: DraftLintFinding["severity"], line: number | null = null): DraftLintFinding {
  return { id, severity, line, messageKey: "doubledWord", params: {} };
}

test("deskGate: blockers first, then the checklist, then unseen warns; info never gates", () => {
  const items = ["a", "b", "disclosure"];
  const findings = [finding("x", "blocker"), finding("w", "warn", 2), finding("i", "info")];
  assert.deepEqual(deskGate(items, {}, findings, new Set()).reason, { kind: "blockers", count: 1 });
  const noBlock = findings.slice(1);
  assert.deepEqual(deskGate(items, { a: true }, noBlock, new Set()).reason, { kind: "checklist", ticked: 1, total: 3 });
  const allTicked = { a: true, b: true, disclosure: true };
  assert.deepEqual(deskGate(items, allTicked, noBlock, new Set()).reason, { kind: "unseen", count: 1 });
  const g = deskGate(items, allTicked, noBlock, new Set(["w"]));
  assert.equal(g.ready, true);
  assert.equal(g.reason, null);
  assert.equal(deskGate(items, { ...allTicked, b: false }, [], new Set()).ready, false);
});

test("markSentGate counts the checklist", () => {
  assert.deepEqual(markSentGate(["a", "disclosure"], { a: true }), { ticked: 1, total: 2, ready: false });
  assert.equal(markSentGate(["a", "disclosure"], { a: true, disclosure: true }).ready, true);
});

test("revealInvisible turns zero-width and direction controls into visible markers", () => {
  const segs = revealInvisible("pay​me‮now");
  assert.deepEqual(segs, [
    { kind: "text", text: "pay" },
    { kind: "invisible", code: "U+200B" },
    { kind: "text", text: "me" },
    { kind: "invisible", code: "U+202E" },
    { kind: "text", text: "now" },
  ]);
  assert.deepEqual(revealInvisible("plain"), [{ kind: "text", text: "plain" }]);
});

test("isTypingTarget: fields swallow shortcuts, checkboxes do not", () => {
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});

test("checklistKeyFor maps 1-9 onto the arena's items", () => {
  assert.equal(checklistKeyFor("1", ["a", "b"]), "a");
  assert.equal(checklistKeyFor("2", ["a", "b"]), "b");
  assert.equal(checklistKeyFor("3", ["a", "b"]), null);
  assert.equal(checklistKeyFor("j", ["a", "b"]), null);
});

test("QUALIFY_BAR restates qualify.ts's threshold exactly", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../_lib/gigs/qualify.ts", import.meta.url)), "utf8");
  const m = /export const QUALIFY_THRESHOLD = (\d+);/.exec(src);
  assert.ok(m, "qualify.ts still declares QUALIFY_THRESHOLD");
  const { QUALIFY_BAR } = await import("./gigsLogic.ts");
  assert.equal(QUALIFY_BAR, Number(m[1]));
});

// ---------------------------------------------------------------------------
// Quick decisions on a gig's page
// ---------------------------------------------------------------------------

test("canQuickDecline offers D exactly where PATCH decline is allowed", () => {
  const offered = (["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "accepted", "rejected", "declined", "expired", "withdrawn"] as GigStatus[]).filter(canQuickDecline);
  assert.deepEqual(offered, ["new", "suspect", "qualified", "drafted", "in_review"]);
});

test("streakTone: 0 of 5 is calm (never absent), rising to the limit", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((n) => streakTone(n, 5)), ["calm", "calm", "watch", "watch", "near", "at", "at"]);
});

test("difficultyBars: unrated fills nothing - it is never drawn as easy", () => {
  assert.deepEqual((["easy", "moderate", "hard", "very_hard", "unrated"] as const).map(difficultyBars), [1, 2, 3, 4, 0]);
});

test("sourceScanView reads the source's own run line; a pause before the run is 'not run'; junk is unknown, never 0 new", () => {
  const result = { sourceId: "s1", notRunnable: 0, aborted: false, sources: [{ sourceId: "s1", outcome: "succeeded", reason: null, created: 3, found: 9, adapter: "github_bounty", paused: null, suspect: 0 }] };
  assert.deepEqual(sourceScanView(result, "s1"), { kind: "ran", outcome: "succeeded", reason: null, created: 3, found: 9 });
  assert.deepEqual(sourceScanView({ ...result, sources: [], notRunnable: 1 }, "s1"), { kind: "not_run" });
  assert.deepEqual(sourceScanView({ ...result, sources: [] }, "s1"), { kind: "unknown" });
  assert.deepEqual(sourceScanView(null, "s1"), { kind: "unknown" });
  assert.deepEqual(sourceScanView({ nope: 1 }, "s1"), { kind: "unknown" });
});

// ---------------------------------------------------------------------------
// The brief's heading ids: the server's assigner, the renderer's walk, one address space
// ---------------------------------------------------------------------------

/** The heading walk Markdown.tsx performs (fenced code skipped, the same trimmed
 *  `#{1,3}` rule), emitting what its `headingId` hook receives. node:test cannot render
 *  the .tsx component, so the walk is restated here; if Markdown.tsx's rule moves, move
 *  this with it. */
function rendererHeadings(markdown: string): { index: number; level: 1 | 2 | 3; text: string }[] {
  const out: { index: number; level: 1 | 2 | 3; text: string }[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(t);
    if (m) out.push({ index: out.length, level: m[1].length as 1 | 2 | 3, text: m[2] });
  }
  return out;
}

test("briefHeadingResolver renders exactly the ids the server's one assigner minted (duplicates, emoji, non-Latin, escapes, fences)", async () => {
  const { parseGigBriefSections } = await import("@/app/_lib/gigs/research.ts");
  const md = [
    "## Overview",
    "Text.",
    "## Overview",
    "### 🚀🚀",
    "## Обзор",
    "```",
    "## not a heading inside a fence",
    "```",
    "## Stored \\*XSS\\* in \\[bio\\]",
    "### **Bold** and `code`",
    "## Overview",
  ].join("\n");
  const sections = parseGigBriefSections(md);
  const resolve = briefHeadingResolver(sections);
  const rendered = rendererHeadings(md).map(resolve);
  assert.deepEqual(rendered, sections.map((s) => s.id), "the renderer and the extractor agree id for id, in order");
  // The instrument fired the paths it exists for.
  assert.ok(rendered.includes("overview-2") && rendered.includes("overview-3"), "duplicate suffixes were exercised");
  assert.equal(rendered.filter((id) => /^section-\d+$/.test(id ?? "")).length, 2, "the emoji and the Cyrillic heading took the positional fallback");
  assert.ok(rendered.every((id) => typeof id === "string"), "every heading got an address");
  // Text agreement is what lets a divergent body degrade instead of mis-addressing.
  for (const [i, h] of rendererHeadings(md).entries()) assert.equal(briefHeadingText(h.text), sections[i].text);
});

test("briefHeadingResolver refuses rather than guesses when the body and its sections disagree", async () => {
  const { parseGigBriefSections } = await import("@/app/_lib/gigs/research.ts");
  const sections = parseGigBriefSections("## One\n## Two");
  const resolve = briefHeadingResolver(sections);
  assert.equal(resolve({ index: 0, level: 2, text: "One" }), "one");
  assert.equal(resolve({ index: 1, level: 2, text: "Changed" }), undefined, "text moved: no id");
  assert.equal(resolve({ index: 1, level: 3, text: "Two" }), undefined, "level moved: no id");
  assert.equal(resolve({ index: 2, level: 2, text: "Three" }), undefined, "past the end: no id");
  // Pure: asking twice (React may render twice) answers the same.
  assert.equal(resolve({ index: 0, level: 2, text: "One" }), "one");
});

test("briefHeadingResolver over a real assembled brief addresses all five fixed sections", async () => {
  const { buildLlmGigBrief } = await import("@/app/_lib/gigs/research.ts");
  const brief = buildLlmGigBrief(
    {
      category: "Web security · Stored XSS",
      title: "Stored XSS in the profile bio",
      difficulty: "hard",
      difficultyReason: "Needs a CSP bypass.",
      effort: { minHours: 12, maxHours: 20, note: null },
      challenges: ["CSP", "Sanitiser"],
      summary: "Find a stored XSS.",
      asks: ["A report"],
    },
    [{ url: "https://example.test/spec", title: "Spec", status: "fetched", reason: null, chars: 1200 }],
    { promptVersion: "gig-brief-v1", createdAt: "2026-09-24T00:00:00.000Z" }
  );
  const ids = rendererHeadings(brief.markdown).map(briefHeadingResolver(brief.sections));
  assert.deepEqual(ids, ["what-the-gig-is", "what-it-asks-for", "difficulty-and-effort", "expected-challenges", "sources-read"]);
  assert.ok(brief.markdown.includes("\n## Sources read\n"), "the page splits the body at this exact line (GigsBrief.tsx)");
});
