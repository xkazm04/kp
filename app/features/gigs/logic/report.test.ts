// Pure logic for the gig's report (report.ts): which sections are open, the brief's asks,
// the lead set as a lead and points, the highlighter's clause, spend so far (never $0 for
// "not reported"), the attempt timeline and the listing's language.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigOutcome, GigPlanRow } from "@/app/_lib/gigs/types.ts";
import { att } from "./fixtures.ts";
import { attemptTimeline, briefAsks, firstClause, foreignLanguage, leadOf, listingOpening, plainInline, reportOpen, spendSoFar, BRIEF_ASKS_HEADING } from "./report.ts";

const FACTS = { brief: false, asks: 0, paired: false, attempt: false, suspect: false, deliverable: false, attempts: 0 };

test("reportOpen: a fresh gig opens only the gig and the plans; each later section waits for its moment", () => {
  assert.deepEqual(reportOpen(FACTS), { gig: true, asks: false, plans: true, progress: false, draft: false, evidence: false, record: false });
  const drafted = reportOpen({ brief: true, asks: 3, paired: true, attempt: true, suspect: false, deliverable: true, attempts: 2 });
  assert.ok(Object.values(drafted).every(Boolean));
  assert.equal(reportOpen({ ...FACTS, brief: true, asks: 0 }).asks, false, "a brief with no asks and no challenges has nothing to show");
  assert.equal(reportOpen({ ...FACTS, suspect: true }).draft, true, "a quarantined listing shows its stamp");
  assert.equal(reportOpen({ ...FACTS, attempt: true, attempts: null }).record, true, "the latest attempt counts while the record loads");
});

test("briefAsks reads the asks section's bullets, and the heading restates research.ts", async () => {
  const md = "## What the gig is\nA page.\n\n## What it asks for\n- A **landing** page\n- [Copy](https://x.test) in `en`\n\n## Difficulty and effort\n- not an ask";
  assert.deepEqual(briefAsks(md), ["A landing page", "Copy in en"]);
  assert.deepEqual(briefAsks("## What it asks for\nThe listing states no deliverables."), []);
  assert.deepEqual(briefAsks(null), []);
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../../_lib/gigs/research.ts", import.meta.url)), "utf8");
  assert.ok(src.includes(`asks: "${BRIEF_ASKS_HEADING}"`), "research.ts still writes the asks under this heading");
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
