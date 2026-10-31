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
import { withoutComments } from "../../../../scripts/review/source-mask.mjs";

const HERE = path.join(process.cwd(), "app", "features", "insights", "analytics");
// Comments are blanked before any assertion reads the source: a commented-out
// `{/* <SpendInput … /> */}` or `// import { SpendInput }` is the chain being cut,
// and a raw-text match would keep this guard green across exactly that edit.
// Strings are kept — the route literal below lives inside one.
const code = (src: string) => withoutComments(src, { line: false });
const read = (...p: string[]) => code(readFileSync(path.join(HERE, ...p), "utf8"));

const IMPORTS_SPEND_INPUT = /import\s*\{[^}]*\bSpendInput\b[^}]*\}\s*from\s*"\.\.\/AnalyticsChannelSpendInput"/;
const RENDERS_SPEND_INPUT = /<SpendInput\b/;

test("the Economics surface renders the spend editor — the only write path to channel_spend", () => {
  const board = read("sections", "EconomicsBoard.tsx");
  assert.match(
    board,
    IMPORTS_SPEND_INPUT,
    "EconomicsBoard must import SpendInput: it is the surface that renders cost-per-hire, so it is the surface that has to let a user enter the spend that figure divides"
  );
  assert.match(board, RENDERS_SPEND_INPUT, "…and actually render it, not merely import it");
});

test("negative control: a commented-out editor does not satisfy the guard", () => {
  const cut = [
    '// import { SpendInput } from "../AnalyticsChannelSpendInput";',
    "export function Board() {",
    "  return (",
    "    <div>",
    "      {/* <SpendInput channel={r.channelId} /> */}",
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  // The raw text matches both — which is why the guard reads masked source.
  assert.match(cut, IMPORTS_SPEND_INPUT);
  assert.match(cut, RENDERS_SPEND_INPUT);
  assert.doesNotMatch(code(cut), IMPORTS_SPEND_INPUT, "a line-commented import is not an import");
  assert.doesNotMatch(code(cut), RENDERS_SPEND_INPUT, "a JSX-commented element is not rendered");
});

test("the editor still posts to the spend route", () => {
  assert.match(
    read("AnalyticsChannelSpendInput.tsx"),
    /"\/api\/analytics\/spend"/,
    "SpendInput is the sole client of POST /api/analytics/spend"
  );
});

test("the spend route still calls the sole writer of the table", () => {
  const route = code(readFileSync(path.join(process.cwd(), "app", "api", "analytics", "spend", "route.ts"), "utf8"));
  assert.match(route, /setChannelSpend\(/, "the route is the sole caller of setChannelSpend");
});

test("every channel row the board draws can carry the editor", () => {
  // The editor keys off the STORED channel id, not the display label — a localized
  // label would write spend against a channel that does not exist. Pin the field so a
  // refactor that drops `channelId` from the row shape fails here rather than on a
  // recruiter's screen.
  // The row model moved to sections/economicsRows.ts (pure, so the three taxonomies'
  // normalization could be tested); the field this guard is about moved with it, so
  // the guard follows it rather than quietly passing on a file that no longer builds
  // rows at all.
  assert.match(read("sections", "economicsRows.ts"), /channelId:\s*r\.channel\b/, "channel rows carry the stored id");
  assert.match(
    read("sections", "EconomicsBoard.tsx"),
    /<SpendInput\s+channel=\{r\.channelId\}/,
    "and the editor writes against that id"
  );
});

// ─── The failure half of the same chain ───────────────────────────────────────
//
// The route answers a failed write with a CODE (`ANALYTICS_SPEND_SAVE_FAILED`, or
// `ANALYTICS_POLICY_FORBIDDEN` when the seat may not run recruiter operations —
// api-contracts.md §1.1). The editor threw a BARE `new Error()` for every one of
// them, and the only rendering was a coral border plus a `title` tooltip carrying one
// flat sentence. So "your role can't change this" and "the write fell over" were the
// same silent red outline, a tooltip is unreachable by keyboard and unannounced by a
// screen reader, and the recruiter's correction to the cost-per-hire denominator
// vanished with no statement that it had.

test("the spend editor resolves the server's CODE instead of throwing a bare Error", () => {
  const input = read("AnalyticsChannelSpendInput.tsx");
  assert.doesNotMatch(input, /throw new Error\(\)/, "a bare Error carries nothing a reader can be told");
  assert.match(input, /apiErrorPayload\(/, "the failed response's {error, code} body must be read");
  assert.match(input, /useErrorMessage\(\)/, "…and resolved in the reader's language");
  assert.match(input, /new LocalizedFailure\(/, "…and handed to the input as an already-localized failure");
});

test("a failed save is announced, not only painted", () => {
  const inline = read("AnalyticsInlineNumberSave.tsx");
  assert.match(inline, /role="alert"/, "a lost write is a failure, so it is assertive — not role=status");
  assert.match(
    inline,
    /localizedFailureMessage\(/,
    "the announced sentence is the resolved code, falling back to the caller's own localized title",
  );
  assert.match(
    read("AnalyticsChannelSpendInput.tsx"),
    /announceFailure/,
    "the spend editor opts into the announcement",
  );
});

test("the save decision is a pure module the test runner can execute", () => {
  const inline = read("AnalyticsInlineNumberSave.tsx");
  assert.match(inline, /planInlineSave\(/, "the parse/normalize/short-circuit rules must not live in the .tsx");
  assert.doesNotMatch(inline, /parsed > 0 \?/, "…and must not be duplicated back into it");
});
