// Pure logic for the gig's Summary (report.ts): which working blocks show, a plan's first
// sentence, the lead set as a lead and points, the highlighter's clause, spend so far (never $0 for
// "not reported"), the attempt timeline and the listing's language.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigOutcome, GigPlanRow } from "@/app/_lib/gigs/types.ts";
import { att } from "./fixtures.ts";
import { attemptTimeline, firstClause, firstSentence, foreignLanguage, leadOf, listingOpening, plainInline, spendSoFar, summaryBlocks } from "./report.ts";

const FACTS = { brief: false, plans: null, accepted: false, draft: false };

test("summaryBlocks: nothing to work on before research; choose a plan, then one line once accepted", () => {
  assert.deepEqual(summaryBlocks(FACTS), { plans: null, draft: false });
  assert.equal(summaryBlocks({ ...FACTS, brief: true }).plans, "choose", "a brief with no plans offers Generate plans");
  assert.equal(summaryBlocks({ ...FACTS, brief: true, plans: 3 }).plans, "choose");
  assert.equal(summaryBlocks({ ...FACTS, plans: 1 }).plans, "choose", "plans outlive a missing brief");
  assert.equal(summaryBlocks({ ...FACTS, brief: true, plans: 3, accepted: true }).plans, "accepted");
  assert.equal(summaryBlocks({ ...FACTS, draft: true }).draft, true);
});

test("firstSentence keeps the first sentence, or cuts a long one on a word", () => {
  assert.equal(firstSentence("Extract with OCR, then reconcile.  Build the workbook."), "Extract with OCR, then reconcile.");
  assert.equal(firstSentence("No full stop at all"), "No full stop at all");
  assert.equal(firstSentence("Uses v1.2 of the API. Then more."), "Uses v1.2 of the API.");
  const cut = firstSentence(`${"word ".repeat(80)}end.`, 60);
  assert.ok(cut.endsWith("…") && cut.length <= 61 && !cut.includes("wor…"), cut);
});

test("leadOf sets prose as the lead and list lines as points, dropping inline marks", () => {
  assert.deepEqual(leadOf("Fixes the **XSS**.\n\n- Adds a test\n- Updates docs"), { lead: "Fixes the XSS.", points: ["Adds a test", "Updates docs"] });
  assert.deepEqual(leadOf("## Heading\nOne. Two."), { lead: "One. Two.", points: [] });
  assert.equal(plainInline("see [the docs](https://x.test) and `npm test`"), "see the docs and npm test");
});

test("firstClause stops at the first clause of the first sentence, never a sliver", () => {
  assert.deepEqual(firstClause("A landing page for a bakery, with an order form. Then more."), ["A landing page for a bakery", ", with an order form. Then more."]);
  assert.deepEqual(firstClause("Short, then a long tail. Next."), ["Short, then a long tail.", " Next."]);
  assert.deepEqual(firstClause("No punctuation at all"), ["No punctuation at all", ""]);
  assert.deepEqual(firstClause("Rebuild the site demo.html now"), ["Rebuild the site demo.html now", ""]);
});

function seat(status: GigPlanRow["status"], costUsd: number | null): GigPlanRow {
  return { id: `p${Math.random()}`, gigId: "g", seat: "sonnet", model: "m", effort: null, status, plan: null, fallbackReason: null, costUsd, durationMs: null, note: null, acceptedAt: null, progress: null, createdAt: "x", updatedAt: "x" };
}

test("spendSoFar adds plans and drafts; an unreported cost is counted apart, never as $0", () => {
  const none = spendSoFar(null, []);
  assert.deepEqual(none, { total: null, plans: null, drafts: null, unreported: 0, ran: false });
  const s = spendSoFar([seat("ready", 0.05), seat("failed", null), seat("running", null)], [att("a1", "g", "drafted", { costUsd: 1.2 }), att("a2", "g", "running", { costUsd: null })]);
  assert.equal(s.plans, 0.05);
  assert.equal(s.drafts, 1.2);
  assert.ok(Math.abs((s.total ?? 0) - 1.25) < 1e-9);
  assert.equal(s.unreported, 1, "a running call has no cost yet; the failed seat reported none");
  const unreported = spendSoFar([seat("ready", null)], []);
  assert.equal(unreported.total, null);
  assert.equal(unreported.ran, true);
});

test("attemptTimeline numbers attempts in run order, lists them newest first, keeps loose verdicts apart", () => {
  const o = (id: string, attemptId: string | null) => ({ id, attemptId }) as GigOutcome;
  const { rows, loose } = attemptTimeline([att("a1", "g", "discarded"), att("a2", "g", "sent")], [o("o1", "a2"), o("o2", null)]);
  assert.deepEqual(rows.map((r) => [r.n, r.attempt.id, r.outcomes.length]), [[2, "a2", 1], [1, "a1", 0]]);
  assert.deepEqual(loose.map((x) => x.id), ["o2"]);
});

test("foreignLanguage names a non-English listing, and nothing for English or an unknown one", () => {
  assert.equal(foreignLanguage("cs"), "cs");
  assert.equal(foreignLanguage("EN"), null);
  assert.equal(foreignLanguage("en-GB"), null);
  assert.equal(foreignLanguage(undefined), null);
  assert.equal(foreignLanguage(""), null);
});

test("listingOpening keeps the first paragraph whole, or cuts it on a word with an ellipsis", () => {
  assert.equal(listingOpening("  First   line.\n\nSecond paragraph."), "First line.");
  const long = `${"word ".repeat(120)}end`;
  const cut = listingOpening(long, 50);
  assert.ok(cut.endsWith("…") && cut.length <= 51 && !cut.includes("wor…"), cut);
});
