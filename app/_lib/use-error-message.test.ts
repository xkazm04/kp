// The error-code resolver's contract, pinned on its pure half.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveErrorMessage, type ErrorMessageValues } from "./use-error-message.ts";

const CATALOG: Record<string, string> = {
  QUOTA_EXCEEDED: "You have used {used} of {limit} analyses.",
  STORE_WRITE_FAILED: "Could not save.",
};

// A stand-in for next-intl's `t`: substitutes {placeholders} from `values`.
const translate = (code: string, values?: ErrorMessageValues): string => {
  const template = CATALOG[code] ?? code;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
};
const has = (code: string) => code in CATALOG;

test("a known code beats the caller's fallback", () => {
  assert.equal(resolveErrorMessage({ code: "STORE_WRITE_FAILED", error: "sqlite: disk I/O" }, "fallback", has, translate), "Could not save.");
});

test("an unknown code falls back — never to the server's English `error`", () => {
  assert.equal(resolveErrorMessage({ code: "NOPE", error: "boom" }, "fallback", has, translate), "fallback");
  assert.equal(resolveErrorMessage({ error: "boom" }, "fallback", has, translate), "fallback");
  assert.equal(resolveErrorMessage(null, "fallback", has, translate), "fallback");
});

test("placeholder values reach the catalog message", () => {
  // The reason this parameter exists: a code carrying numbers ("3 of 5 used")
  // could not be expressed, so those messages stayed hand-built in English at
  // the call site, outside the errors catalog entirely.
  assert.equal(
    resolveErrorMessage({ code: "QUOTA_EXCEEDED" }, "fallback", has, translate, { used: 3, limit: 5 }),
    "You have used 3 of 5 analyses."
  );
});

test("values are ignored when the code is unknown — the fallback is already localized", () => {
  assert.equal(resolveErrorMessage({ code: "NOPE" }, "fallback", has, translate, { used: 3 }), "fallback");
});
