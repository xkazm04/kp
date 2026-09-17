import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jsonFetchFailure } from "./useJsonFetch.ts";
import { resolveErrorMessage } from "./use-error-message.ts";

// The paged-read failure half, pinned without a DOM: a 500 carrying English
// `error` prose plus a machine `code` paints the catalog (or the caller's
// localized label), never the prose. Same precedence as useJsonFetch.test.ts.

const CATALOG: Record<string, string> = { DECISION_LOG_LOAD_FAILED: "Nepodařilo se načíst deník rozhodnutí." };
const say = (code: string | null, fallback: string) =>
  resolveErrorMessage(
    { code },
    fallback,
    (c) => c in CATALOG,
    (c) => CATALOG[c]
  );

test("a 500 with English error + a known code paints the catalog, not the English", () => {
  const f = jsonFetchFailure(false, 500, {
    error: "Could not load the decision log. Please try again.",
    code: "DECISION_LOG_LOAD_FAILED",
  })!;
  assert.equal(f.status, 500);
  assert.equal(say(f.code, "Couldn't load this."), CATALOG.DECISION_LOG_LOAD_FAILED);
});

test("a 500 with English error + an unknown code paints the caller's label, not the English", () => {
  const f = jsonFetchFailure(false, 500, { error: "sqlite: disk I/O error", code: "NOT_IN_CATALOG" })!;
  assert.equal(say(f.code, "Couldn't load this."), "Couldn't load this.");
});

test("useInfiniteScroll keeps the failure as { code, status } and never assigns body.error", () => {
  const src = readFileSync(fileURLToPath(new URL("./useInfiniteScroll.ts", import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  assert.match(src, /jsonFetchFailure\(/);
  assert.match(src, /useErrorMessage\(/);
  assert.match(src, /resolveMessage\(\{ code: failure\.code \}, errorLabel\)/);
  assert.doesNotMatch(src, /body\?\.error/, "body.error must not reach the user-facing string");
  assert.doesNotMatch(src, /e\.message/, "a thrown Error message must not become the painted error");
  assert.doesNotMatch(src, /setError\(/, "error is derived from failure, not stored as prose");
});
