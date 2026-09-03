// remaining-add-callers-read-the-code (wave 19b) — the report's "Add to pipeline"
// button painted `result.message`, the server's canonical ENGLISH, into
// report.addFailed. A Czech, German or French recruiter refused by the capability
// gate read an English sentence; nobody read the code the door had already sent.
//
// Non-vacuity: against pre-fix code every assertion here fails — the component did
// not import useErrorMessage, `report.addFailed` still carried an {error}
// placeholder, and `setError(result.message)` was the whole error path.
//
// The repo has no React renderer, so the component contract is pinned by reading
// the source (the technique usePipelineBulk.test.ts / PassPreviewModal.test.ts use).
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capabilityAwareReason, resolveErrorMessage } from "../../_lib/use-error-message.ts";

const src = readFileSync(new URL("./AddToPipelineButton.tsx", import.meta.url), "utf8");

test("the button resolves the refusal from its CODE, never from the server's message", () => {
  assert.match(src, /useErrorMessage/, "the component must bind the code resolver");
  assert.match(src, /capabilityAwareReason\(errMsg, result, t\("addFailed"\)\)/, "…and fold a capability refusal into it");
  assert.doesNotMatch(src, /result\.message/, "the server's English must never reach the status line");
});

test("report.addFailed is a standalone localized fallback, not an English carrier", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      report: Record<string, string>;
    };
    const msg = cat.report.addFailed;
    assert.ok(msg, `${locale}: report.addFailed must exist`);
    assert.doesNotMatch(msg, /\{error\}/, `${locale}: addFailed must not splice a server string in`);
  }
});

// The behaviour the button now has, exercised on the REAL catalog: a 403 carrying a
// code renders the localized sentence in the reader's language.
test("a coded 403 renders the reader's language, not the door's English", () => {
  const cs = JSON.parse(readFileSync(new URL("../../../messages/cs.json", import.meta.url), "utf8")) as {
    errors: Record<string, string>;
    report: Record<string, string>;
  };
  const resolve = (
    payload: { code?: string | null; error?: string | null } | null | undefined,
    fallback: string,
    values?: Record<string, string | number | Date>
  ) =>
    resolveErrorMessage(
      payload,
      fallback,
      (c) => c in cs.errors,
      (c, v) => {
        const tpl = cs.errors[c];
        return v ? tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : tpl;
      },
      values
    );
  const shown = capabilityAwareReason(
    resolve,
    { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write", error: "Your role does not allow this action." },
    cs.report.addFailed
  );
  assert.match(shown, /pipeline:write/, "the missing permission must be named");
  assert.notEqual(shown, "Your role does not allow this action.", "…and not in English");
});
