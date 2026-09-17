// Source pins for the Explain-fit panel's error face. The unit runner has no DOM
// renderer, so these read the component as text (same pattern as apply conversion
// guards).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "MatchReasoningPanel.tsx"), "utf8");
const catalog = (locale: string) =>
  JSON.parse(readFileSync(path.join(HERE, `../../../messages/${locale}.json`), "utf8")) as {
    match: { shared: Record<string, string> };
  };

test("error face with onRetry paints a retry button; without onRetry stays text-only", () => {
  assert.match(src, /onRetry\?: \(\) => void/, "retry is optional so callers that cannot retry stay as today");
  const errorFace = src.slice(src.indexOf("state.error"), src.indexOf("state.data"));
  assert.ok(errorFace.length > 0, "could not isolate the error face");
  assert.match(errorFace, /onRetry \?/, "the button is gated on the optional callback");
  assert.match(errorFace, /BTN_GHOST/, "retry composes the ghost recipe");
  assert.match(errorFace, /t\("retryReasoning"\)/, "retry label is catalogued");
  assert.match(errorFace, /role="alert"/, "the error copy is an alert");
});

test("retryReasoning is present in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"] as const) {
    const value = catalog(locale).match.shared.retryReasoning;
    assert.equal(typeof value, "string", `${locale} match.shared.retryReasoning`);
    assert.ok(value.trim().length > 0, `${locale} retryReasoning must not be blank`);
  }
});
