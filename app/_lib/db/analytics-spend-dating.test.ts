// UAT KAT-ANA-2 — THE SPEND FIGURE MUST DATE ITSELF, AND MUST STAY REACHABLE.
//
// `channel_spend` is written by exactly one function, reached from exactly one route,
// called by exactly one component. No seeder writes it. So every cost-per-hire figure
// in the product traces back to a number a person typed once — and nothing about that
// number moves when it goes stale. On the live host `833 CZK / hire` was a single row
// (linkedin = 5,000 CZK) entered six weeks earlier by a prior test session, still
// rendering as a current metric because the surface had no way to say how old it was.
//
// Two properties are pinned here, because the first without the second is cosmetic:
//   1. every figure derived from a stored row travels with that row's `updated_at`;
//   2. every stored row reaches the surface that edits it — including a channel that
//      has spend but no candidates, which is precisely the row that went uneditable.
//
// (testing/unit-db.ts must be the first project import — see that module's header.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics } from "./analytics.ts";
import { setChannelSpend, listChannelSpend, listChannelSpendDetail } from "./channels.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const WS = "spend-dating-ws";
const FOSSIL_AT = "2026-07-05T19:48:57.395Z";

test("setup — one attributed channel with a hire, plus a fossil spend row", () => {
  const { entry } = createPipelineEntry({
    candidateId: "sd-1",
    candidateLabel: "sd-1",
    jobId: "sd-job",
    jobTitle: "Role",
    stage: "Hired",
    workspaceId: WS,
  });
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET source_channel = 'apply' WHERE id = ?`).run(entry.id);
  setChannelSpend("apply", 4000, WS);
  // A channel someone paid for that produced no attributed candidate at all — the
  // shape the live fossil had, and the one that used to have no row to edit.
  setChannelSpend("linkedin", 5000, WS);
  db.prepare(`UPDATE channel_spend SET updated_at = ? WHERE channel = 'linkedin' AND workspace_id = ?`).run(FOSSIL_AT, WS);
});

test("the store hands back the entry date, not just the amount", () => {
  const detail = listChannelSpendDetail(WS);
  assert.equal(detail.get("linkedin")?.amountCzk, 5000);
  assert.equal(detail.get("linkedin")?.updatedAt, FOSSIL_AT);
  // The bare-number form still answers its own question, so existing callers are unmoved.
  assert.equal(listChannelSpend(WS).get("linkedin"), 5000);
});

test("every per-channel money figure carries the date of the row it divides", () => {
  const a = pipelineAnalytics(undefined, undefined, WS);
  const apply = a.byChannel.find((c) => c.channel === "apply");
  assert.ok(apply, "the attributed channel has a row");
  assert.equal(apply.costPerHireCzk, 4000, "4000 CZK / 1 hire");
  assert.ok(apply.spendUpdatedAt, "…and the cost figure states when its input was entered");
});

test("a channel with spend but NO candidates still gets a row, so the figure stays editable", () => {
  const a = pipelineAnalytics(undefined, undefined, WS);
  const fossil = a.byChannel.find((c) => c.channel === "linkedin");
  assert.ok(fossil, "a paid-for channel that produced nobody is a finding, not an absence");
  assert.equal(fossil.total, 0);
  assert.equal(fossil.spendCzk, 5000, "the editor renders off this row — no row, no way to correct it");
  assert.equal(fossil.spendUpdatedAt, FOSSIL_AT);
  // Zero leads yields no cost-per figure rather than a division by zero.
  assert.equal(fossil.costPerApplicantCzk, null);
  assert.equal(fossil.costPerHireCzk, null);
});

test("the blended cost per hire is dated by its OLDEST input, not its newest", () => {
  const a = pipelineAnalytics(undefined, undefined, WS);
  assert.equal(a.costPerHireCzk, 9000, "(4000 + 5000) / 1 hire");
  assert.equal(
    a.costPerHireAsOf,
    FOSSIL_AT,
    "a blend is only as current as its stalest input — quoting the newest would let one fresh row launder a fossil"
  );
});

test("no blended figure, no date — the stamp never outlives the number it describes", () => {
  const a = pipelineAnalytics(30, undefined, WS);
  assert.equal(a.costPerHireCzk, null, "windowed views suppress the lifetime-spend ratio (unchanged)");
  assert.equal(a.costPerHireAsOf, null);
});

test("clearing the spend clears the row and its date together", () => {
  setChannelSpend("linkedin", null, WS);
  const a = pipelineAnalytics(undefined, undefined, WS);
  assert.equal(a.byChannel.find((c) => c.channel === "linkedin"), undefined, "nothing stored, nothing to edit, no row");
  assert.equal(a.costPerHireCzk, 4000, "the blend falls back to the one surviving entry");
  assert.ok(a.costPerHireAsOf, "which still dates itself");
});
