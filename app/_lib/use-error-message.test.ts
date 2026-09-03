// The error-code resolver's contract, pinned on its pure half.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityAwareReason, resolveErrorMessage, type ErrorMessageValues } from "./use-error-message.ts";

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

// ---- capabilityAwareReason (wave 19b) ----------------------------------------
// The capability-aware fold used to live in app/_lib/useAddToPipeline.ts — a
// transport module about ONE route — even though five surfaces that never add a
// candidate imported it. It belongs beside the rule it implements: prefer the
// code, and when the code is FORBIDDEN_CAPABILITY and the client HOLDS the
// permission it named, render the variant that says which permission.
const GATE_CATALOG: Record<string, string> = {
  FORBIDDEN_CAPABILITY: "Your role does not allow this action.",
  forbiddenCapabilityNeeds: "Your role does not allow this action. It needs the “{capability}” permission.",
  STORE_WRITE_FAILED: "Could not save.",
};
const gateResolve = (
  payload: { code?: string | null; error?: string | null } | null | undefined,
  fallback: string,
  values?: ErrorMessageValues
) =>
  resolveErrorMessage(payload, fallback, (c) => c in GATE_CATALOG, (c, v) => {
    const template = GATE_CATALOG[c] ?? c;
    return v ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : template;
  }, values);

test("capabilityAwareReason names the permission a FORBIDDEN_CAPABILITY refusal wanted", () => {
  assert.equal(
    capabilityAwareReason(gateResolve, { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write", error: "nope" }, "fb"),
    "Your role does not allow this action. It needs the “pipeline:write” permission."
  );
});

test("capabilityAwareReason falls back to the plain code message with no capability", () => {
  assert.equal(
    capabilityAwareReason(gateResolve, { code: "FORBIDDEN_CAPABILITY" }, "fb"),
    "Your role does not allow this action."
  );
});

test("capabilityAwareReason is a pass-through for any other code, and never shows `error`", () => {
  assert.equal(capabilityAwareReason(gateResolve, { code: "STORE_WRITE_FAILED", error: "sqlite: disk I/O" }, "fb"), "Could not save.");
  assert.equal(capabilityAwareReason(gateResolve, { error: "sqlite: disk I/O" }, "fb"), "fb");
  assert.equal(capabilityAwareReason(gateResolve, null, "fb"), "fb");
});
