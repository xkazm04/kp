// Contract test for the edge card's drain handler: a REFUSAL is rendered as a
// refusal.
//
// The bug this pins: `drainNow` read only `d.summary.error`. The drain door is
// operator- AND capability-gated (`org:manage`, app/api/edge/drain/route.ts), and
// a 403 or a 500 carries no `summary` at all — so the handler fell through to the
// success branch and rendered `drained` ("Drained: 0 filed, 0 skipped") in the
// positive style. That is the same green sentence a healthy, quiet queue produces,
// which means the one state an operator most needs to see (I am not allowed to do
// this / this install is broken) was indistinguishable from "nothing to do".
//
// kp convention for a client component with no render harness: a source-level
// guard, like decisionsOfferCardScore.test.ts and channels-receiver-contract.test.ts.
// It reads the file and asserts the shape of the decision, plus the one thing a
// source guard CAN check exactly — that the failure-class map is total over the
// closed union it is keyed by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EDGE_ERROR_KINDS } from "@/app/_lib/edge-config";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// CRLF in one checkout, LF in the worktree: normalize before any anchored match.
const src = readFileSync(path.join(DIR, "ChannelsEdgeCard.tsx"), "utf-8").replace(/\r\n/g, "\n");

// The handler body, so an assertion cannot be satisfied by an `r.ok` check that
// lives in `save` or `enableSealing`.
const drainNow = (() => {
  const start = src.indexOf("const drainNow = useCallback");
  assert.ok(start > 0, "drainNow handler not found in ChannelsEdgeCard.tsx");
  const end = src.indexOf("const enableSealing = useCallback", start);
  assert.ok(end > start, "enableSealing (the drainNow terminator) not found");
  return src.slice(start, end);
})();

test("drainNow branches on the RESPONSE status, not only on summary.error", () => {
  assert.match(
    drainNow,
    /!r\.ok/,
    "a non-ok drain response must be a failure branch; without it a 403/500 renders the green 'drained' sentence"
  );
  const okBranch = drainNow.indexOf('t("drained"');
  const failCheck = drainNow.indexOf("!r.ok");
  assert.ok(failCheck < okBranch, "the non-ok check must run BEFORE the success sentence is chosen");
});

test("a refused drain is shown in the failure style, resolved from its code", () => {
  // `ok: false` selects text-coral at the render site; `errMsg` is useErrorMessage,
  // which resolves `errors.<CODE>` in the reader's language and never renders the
  // server's English `error` string.
  assert.match(drainNow, /setNote\(\{ ok: false, text: kind \? t\(DRAIN_ERROR_KEY\[kind\]\) : errMsg\(d,/);
  assert.match(drainNow, /errMsg\(d, t\("drainFailedUnknown"\)\)/, "the fallback must be a localized sentence, not a raw message");
  // `code` has to be read off the body for errMsg to have anything to resolve.
  assert.match(drainNow, /code\?: string/, "the parsed drain body must carry `code`");
});

test("errMsg is in the handler's dependency list", () => {
  assert.match(drainNow, /\}, \[t, errMsg, readConfig, adopt\]\)/);
});

test("enableSealing already reports its refusal by code", () => {
  const seal = src.slice(src.indexOf("const enableSealing = useCallback"));
  assert.match(seal, /errMsg\(d, t\("sealFailed"\)\)/);
});

test("DRAIN_ERROR_KEY is total over EDGE_ERROR_KINDS", () => {
  const map = src.slice(src.indexOf("const DRAIN_ERROR_KEY"), src.indexOf("export function EdgeConfigCard"));
  for (const kind of EDGE_ERROR_KINDS) {
    assert.match(map, new RegExp(`\\n  ${kind}: "drainFailed`), `no localized sentence mapped for edge error kind '${kind}'`);
  }
});
