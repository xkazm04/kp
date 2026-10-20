// The pre-send lint (draft-lint.ts). Pure: every rule is pinned with a positive and the
// negative it must leave alone, plus the severity contract the desk's Approve gate reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_LINT_KEYS, bySeverity, draftLines, lintDraft, lintGate, type DraftLintInput } from "./draft-lint.ts";
import type { GigDeliverable } from "./types.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function deliverable(p: Partial<GigDeliverable> = {}): GigDeliverable {
  return {
    version: 1,
    summary: "A fix for the parser.",
    draftText: "Fixes the parser.\n\nAI assistance was used to draft this change.",
    artifacts: [],
    evidence: [{ kind: "test", command: "npm test", result: "12 passed", passed: true }],
    disclosure: "AI assistance was used to draft this change.",
    confidence: 0.7,
    questions: [],
    ...p,
  };
}

function input(p: { dl?: Partial<GigDeliverable> | null; reward?: DraftLintInput["gig"]["reward"]; deadlineAt?: string | null; cost?: number | null; source?: DraftLintInput["source"] } = {}): DraftLintInput {
  return {
    gig: { reward: p.reward === undefined ? { amount: 200, currency: "USD", text: "$200" } : p.reward, deadlineAt: p.deadlineAt ?? null },
    attempt: { deliverable: p.dl === null ? null : deliverable(p.dl ?? {}), costUsd: p.cost === undefined ? 0.42 : p.cost },
    source: p.source ?? null,
    now: NOW,
  };
}

const keys = (i: DraftLintInput) => lintDraft(i).map((f) => f.messageKey);

test("a clean draft yields no findings", () => {
  assert.deepEqual(lintDraft(input()), []);
});

test("doubled words and article pairs are warns anchored to their 1-based line, with the excerpt", () => {
  const f = lintDraft(input({ dl: { draftText: "Line one.\nThis fixes the the bug.\nWe add an the test.\nAI assistance was used to draft this change." } }));
  const doubled = f.filter((x) => x.messageKey === "doubledWord");
  assert.equal(doubled.length, 2);
  assert.deepEqual(
    doubled.map((x) => [x.line, x.params.excerpt, x.severity]),
    [
      [2, "the the", "warn"],
      [3, "an the", "warn"],
    ]
  );
  // Case-insensitive, non-ASCII letters too.
  assert.equal(lintDraft(input({ dl: { draftText: "The the start. Že že.\nAI assistance was used to draft this change." } })).filter((x) => x.messageKey === "doubledWord").length, 1);
});

test("doubled words leave numbers, hyphenated words and fenced code alone", () => {
  const text = "Rows 10 10 match.\nA go-go dancer.\n```\nreturn return\n```\nAI assistance was used to draft this change.";
  assert.deepEqual(keys(input({ dl: { draftText: text } })), []);
});

test("a draft that talks money is flagged only when the listing stated no reward", () => {
  const text = "I will do it for $500 flat.\nAI assistance was used to draft this change.";
  assert.deepEqual(keys(input({ dl: { draftText: text } })), []);
  const f = lintDraft(input({ reward: null, dl: { draftText: text } }));
  assert.deepEqual(f.map((x) => [x.messageKey, x.line, x.params.excerpt]), [["rewardMentioned", 1, "$500"]]);
  const phrase = lintDraft(input({ reward: null, dl: { draftText: "For an unstated amount.\nAI assistance was used to draft this change." } }));
  assert.equal(phrase[0].params.excerpt, "unstated amount");
  assert.deepEqual(keys(input({ reward: null, dl: { draftText: "A reward function for the agent.\nAI assistance was used to draft this change." } })), []);
});

test("evidence: failed is a blocker, no command is info, unverified (passed null) is not a finding", () => {
  const f = lintDraft(
    input({
      dl: {
        evidence: [
          { kind: "test", command: "npm test", result: "2 failed", passed: false },
          { kind: "repro", command: null, result: "Reproduced by hand", passed: true },
          { kind: "score", command: "python eval.py", result: "0.81", passed: null },
        ],
      },
    })
  );
  assert.deepEqual(
    f.map((x) => [x.messageKey, x.severity, x.params.n]),
    [
      ["evidenceFailed", "blocker", 1],
      ["evidenceNoCommand", "info", 2],
    ]
  );
});

test("a cost never reported is info; a reported $0 is not a finding", () => {
  assert.deepEqual(keys(input({ cost: null })), ["costUnreported"]);
  assert.deepEqual(keys(input({ cost: 0 })), []);
});

test("a passed deadline is a blocker; a future or absent one is not", () => {
  const f = lintDraft(input({ deadlineAt: "2026-09-20T00:00:00.000Z" }));
  assert.deepEqual(f.map((x) => [x.messageKey, x.severity, x.line]), [["deadlinePassed", "blocker", null]]);
  assert.deepEqual(keys(input({ deadlineAt: "2026-10-20T00:00:00.000Z" })), []);
  assert.deepEqual(keys(input({ deadlineAt: null })), []);
});

test("only an invalid_streak pause blocks; other pauses are not the draft's problem", () => {
  const f = lintDraft(input({ source: { pausedReason: "invalid_streak", invalidStreak: 5, host: "api.hackerone.com" } }));
  assert.deepEqual(f.map((x) => [x.messageKey, x.severity, x.params.streak]), [["sourceInvalidStreak", "blocker", 5]]);
  assert.deepEqual(keys(input({ source: { pausedReason: "no_key", invalidStreak: 0, host: "www.kaggle.com" } })), []);
});

test("the disclosure: absent is a blocker, present but not in the draft is a warn, whitespace and case do not count", () => {
  assert.deepEqual(keys(input({ dl: { disclosure: "  " } })), ["disclosureAbsent"]);
  assert.deepEqual(keys(input({ dl: { draftText: "Fixes the parser." } })), ["disclosureNotInDraft"]);
  assert.deepEqual(keys(input({ dl: { draftText: "Fixes it.\nai   assistance was used\nto draft this change" } })), []);
});

test("each open question is its own warn", () => {
  const f = lintDraft(input({ dl: { questions: ["Which branch?", "  ", "Is IE11 in scope?"] } }));
  assert.deepEqual(f.map((x) => [x.messageKey, x.id, x.params.question]), [
    ["questionOpen", "question:0", "Which branch?"],
    ["questionOpen", "question:2", "Is IE11 in scope?"],
  ]);
});

test("no deliverable is a blocker and nothing else about the draft is claimed", () => {
  assert.deepEqual(keys(input({ dl: null, cost: null })), ["noDeliverable", "costUnreported"]);
});

test("ids are unique and stable across runs; every key is declared", () => {
  const i = input({
    reward: null,
    cost: null,
    deadlineAt: "2026-09-01T00:00:00.000Z",
    source: { pausedReason: "invalid_streak", invalidStreak: 5, host: "h" },
    dl: { draftText: "the the $5\nthe the $6", questions: ["a?", "b?"], evidence: [{ kind: "gate", command: null, result: "x", passed: false }] },
  });
  const a = lintDraft(i);
  assert.equal(new Set(a.map((f) => f.id)).size, a.length);
  assert.deepEqual(lintDraft(i), a);
  for (const f of a) assert.ok((DRAFT_LINT_KEYS as readonly string[]).includes(f.messageKey));
});

test("lintGate counts blockers and unseen warns; info never gates", () => {
  const f = lintDraft(input({ reward: null, cost: null, dl: { draftText: "the the $5", questions: ["q?"] }, deadlineAt: "2026-09-01T00:00:00.000Z" }));
  const g0 = lintGate(f, new Set());
  assert.equal(g0.blockers, 1);
  assert.equal(g0.warns, 4); // doubled, reward, disclosure not in draft, question
  assert.equal(g0.unseenWarns, 4);
  const seen = new Set(f.filter((x) => x.severity === "warn").map((x) => x.id));
  assert.equal(lintGate(f, seen).unseenWarns, 0);
});

test("bySeverity puts blockers first and keeps rule order within a severity", () => {
  const f = lintDraft(input({ cost: null, reward: null, dl: { draftText: "the the", evidence: [{ kind: "test", command: "x", result: "y", passed: false }] } }));
  assert.deepEqual(bySeverity(f).map((x) => x.severity), ["blocker", "warn", "warn", "info"]);
});

test("draftLines splits on LF and CRLF", () => {
  assert.deepEqual(draftLines("a\r\nb\nc"), ["a", "b", "c"]);
});
