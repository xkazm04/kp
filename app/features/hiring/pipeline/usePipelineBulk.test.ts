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

test("a whole-request refusal prefers the server's CODE over the client's sentence", () => {
  assert.match(
    hook,
    /res\.code\s*\r?\n?\s*\? \{ reason: null, codes: \[res\.code\], capability: res\.capability \?\? null \}/,
    "batchRequestRefusal must hand the code (and the capability it named) to the bar"
  );
  assert.match(hook, /: \{ reason: batchRequestReason\(res\), codes: \[\], capability: null \}/, "…and only fall back when there is none");
});

test("bulk invite reads the refusal body instead of counting silent failures", () => {
  const invite = hook.slice(hook.indexOf("const bulkInvite"), hook.indexOf("const bulkOutreach"));
  assert.match(invite, /code\?: string; capability\?: string/, "the invite response body must be typed with its refusal half");
  assert.match(invite, /batchRequestRefusal\(\{ ok: false, status: r\.status, code: d\?\.code \?\? null, capability: d\?\.capability \?\? null \}\)/);
  assert.match(invite, /reasonCodes: requestCodes/, "…and the codes must reach bulkResult");
});

test("the bar renders a capability refusal with the permission as data", () => {
  assert.match(bar, /refusalCapability\?: string \| null;/, "the bar must accept the capability the hook carried");
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
