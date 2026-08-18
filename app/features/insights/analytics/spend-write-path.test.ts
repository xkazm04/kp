// UAT KAT-ANA-2 — PIN THE ONE EDGE THAT WENT MISSING.
//
// `channel_spend` has a single write chain, and every link in it is the only one of
// its kind:
//
//   SpendInput  →  POST /api/analytics/spend  →  setChannelSpend()  →  channel_spend
//
// No seeder writes the table. So if the FIRST link stops being rendered, the entire
// ability to record or correct cost-per-hire disappears — silently, because the figure
// keeps rendering from whatever was last stored. That is exactly what happened: the
// section consolidation stopped importing the panel that hosted the editor, and for the
// life of that change the live surface showed `833 CZK / hire` derived from a single
// row a prior test session had entered six weeks earlier, with no way for any user to
// update or clear it.
//
// The behavioral half (dating, reachability of every stored row) is pinned in
// db/analytics-spend-dating.test.ts. THIS file pins the half no behavioral test can
// reach without a DOM: that the chain is still wired at all. It is deliberately a
// source-level assertion, because "is this component still reachable from the section
// that renders the number" is a fact about the import graph, not about runtime state.
//
// A broader walker — fail on ANY unreachable panel or unimported barrel export — is
// backlog item 11. This is the one edge whose loss is a data-integrity bug, so it gets
// its own named guard rather than waiting for the general one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.join(process.cwd(), "app", "features", "insights", "analytics");
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

test("the Economics surface renders the spend editor — the only write path to channel_spend", () => {
  const board = read("sections", "EconomicsBoard.tsx");
  assert.match(
    board,
    /import\s*\{[^}]*\bSpendInput\b[^}]*\}\s*from\s*"\.\.\/AnalyticsChannelSpendInput"/,
    "EconomicsBoard must import SpendInput: it is the surface that renders cost-per-hire, so it is the surface that has to let a user enter the spend that figure divides"
  );
  assert.match(board, /<SpendInput\b/, "…and actually render it, not merely import it");
});

test("the editor still posts to the spend route", () => {
  assert.match(
    read("AnalyticsChannelSpendInput.tsx"),
    /"\/api\/analytics\/spend"/,
    "SpendInput is the sole client of POST /api/analytics/spend"
  );
});

test("the spend route still calls the sole writer of the table", () => {
  const route = readFileSync(path.join(process.cwd(), "app", "api", "analytics", "spend", "route.ts"), "utf8");
  assert.match(route, /setChannelSpend\(/, "the route is the sole caller of setChannelSpend");
});

test("every channel row the board draws can carry the editor", () => {
  // The editor keys off the STORED channel id, not the display label — a localized
  // label would write spend against a channel that does not exist. Pin the field so a
  // refactor that drops `channelId` from the row shape fails here rather than on a
  // recruiter's screen.
  const board = read("sections", "EconomicsBoard.tsx");
  assert.match(board, /channelId:\s*r\.channel\b/, "channel rows carry the stored id");
  assert.match(board, /<SpendInput\s+channel=\{r\.channelId\}/, "and the editor writes against that id");
});
