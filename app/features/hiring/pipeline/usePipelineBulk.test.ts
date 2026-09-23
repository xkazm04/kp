// gated-doors-clients-read-the-refusal — the bulk hook's THREE gated doors
// (/api/pipeline/batch twice, /api/schedule/invite/bulk once) must carry the
// server's refusal CODE to the bar, which renders it through errors.<CODE> in the
// reader's language.
//
// The defect: bulk invite was `if (r.ok && d?.results) … else { fail everyone }` —
// a viewer refused by the capability gate read "0 invited · N failed" with no
// reason at all, and the two batch calls collapsed every whole-request refusal
// (401, 403, 500) into one client sentence even when the server had named a code
// and the permission it wanted.
//
// Non-vacuity: against pre-fix code every assertion here fails — `refusalCapability`
// did not exist, `batchRequestRefusal` did not exist, and the invite branch had no
// body read at all.
//
// The hook is React state over a fetch and the repo has no component renderer, so
// the contract is pinned by reading the source — the technique PipelineFilterBar.test.ts
// and pipelineMoveTargets.test.ts already use for this directory.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveErrorMessage } from "../../../_lib/use-error-message.ts";

const hook = readFileSync(new URL("./usePipelineBulk.ts", import.meta.url), "utf8");
const bar = readFileSync(new URL("./PipelineBulkActionBar.tsx", import.meta.url), "utf8");

// Re-anchored by challenge-r06 pipeline-move-bulk-operations/A: the refusal fold moved
// out of the hook into ONE pure function (pipelineBulkSelection.foldBatchSettle), so the
// preference is now pinned by BEHAVIOUR there (pipelineBulkSelection.test.ts) and by
// source here: every door must hand the fold the code AND the capability it read.
const selection = readFileSync(new URL("./pipelineBulkSelection.ts", import.meta.url), "utf8");

test("a whole-request refusal prefers the server's CODE over the client's sentence", () => {
  assert.match(
    selection,
    /reasonCodes: coded \? \[response\.code as string\] : \[\],\s*refusalCapability: coded \? \(response\.capability \?\? null\) : null/,
    "the fold must hand the code (and the capability it named) to the bar"
  );
  assert.match(selection, /reasonKey: coded \? null :/, "…and only fall back to a client sentence when there is none");
});

test("bulk invite reads the refusal body instead of counting silent failures", () => {
  const invite = hook.slice(hook.indexOf("const bulkInvite"), hook.indexOf("const bulkOutreach"));
  assert.match(invite, /code\?: string; capability\?: string/, "the invite response body must be typed with its refusal half");
  assert.match(invite, /\{ ok: false, status: r\.status, code: d\?\.code \?\? null, capability: d\?\.capability \?\? null \}/);
  assert.match(invite, /code: x\.code/, "…the per-item codes must reach the fold");
  assert.match(invite, /foldBatchSettle\(/, "…and it settles through the one fold, whose codes reach bulkResult");
});

test("the bar renders a capability refusal with the permission as data", () => {
  // The bar's status-line type IS the reducer's (one definition since challenge-r06).
  assert.match(bar, /import type \{ BulkResult as BulkSelectionResult \} from "\.\/pipelineBulkSelection"/);
  assert.match(selection, /refusalCapability\?: string \| null;/, "the bar must accept the capability the hook carried");
  assert.match(
    bar,
    /capabilityAwareReason\(errMsg, \{ code, capability: bulkResult\.refusalCapability \}, t\("bulkRequestFailed"\)\)/,
    "…and fold it into the localized sentence rather than painting a bare code"
  );
  assert.doesNotMatch(bar, /bulkResult\.reason\b[^C]*\.error/, "the bar never paints a server `error` string");
});

// The fold itself, against the real catalog: a FORBIDDEN_CAPABILITY payload that
// carries data must resolve to the sentence that NAMES the permission, never to the
// server's English and never to the generic line.
test("errors.forbiddenCapabilityNeeds resolves with the capability, never the English", () => {
  const en = JSON.parse(readFileSync(new URL("../../../../messages/en.json", import.meta.url), "utf8")) as {
    errors: Record<string, string>;
  };
  const has = (code: string) => code in en.errors;
  const translate = (code: string, values?: Record<string, string | number | Date>) =>
    en.errors[code].replace(/\{(\w+)\}/g, (_m, k: string) => String(values?.[k] ?? `{${k}}`));
  const named = resolveErrorMessage({ code: "forbiddenCapabilityNeeds" }, "fallback", has, translate, {
    capability: "pipeline:write",
  });
  assert.match(named, /pipeline:write/, "the capability is data in the localized sentence");
  assert.doesNotMatch(named, /\{capability\}/, "…and it is actually interpolated");
  assert.notEqual(named, en.errors.FORBIDDEN_CAPABILITY, "the named variant is not the generic one");
});

// cohort-drift-forces-a-fresh-review (challenge-r06 pipeline-move-bulk-operations/A) -
// every selection change is a reducer event. There were 9 `setSelectedIds` call sites,
// 5 paired with a hand-dispatched `selectionChanged`, and bulkMove forgot its pair, so
// an armed confirm outlived its own settle. The cells are gone; only events remain.
test("the hook changes the selection only through bulkSelectionReducer events", () => {
  assert.equal((hook.match(/setSelectedIds\(/g) ?? []).length, 0, "no setSelectedIds call site");
  assert.doesNotMatch(hook, /useState<ReadonlySet<string>>/, "the selection is not a loose useState cell");
  assert.doesNotMatch(hook, /setBulkResult\(|setOutreachTaskId\(|setBulkBusy\(/, "result/task/busy are reducer state too");
  assert.match(hook, /useReducer\(bulkSelectionReducer/, "one reducer owns selection, confirm, result, busy and the task");
  // The failures-stay-selected fold is written ONCE (pipelineBulkSelection.foldBatchSettle).
  assert.doesNotMatch(hook, /failures\.add\(|failed\.add\(/, "the hook no longer re-implements the fold");
  assert.ok((hook.match(/foldBatchSettle\(/g) ?? []).length >= 3, "move, decide and invite all settle through the one fold");
  // A confirm is checked against the cohort it SIGNED, not only the scope.
  assert.doesNotMatch(hook, /armedConfirm\(bulkConfirm, visibleScope\)/, "the scope-only check is the drift hole");
  assert.match(hook, /armedBulkConfirm\(/);
});
