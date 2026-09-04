// The refusal-label chain an archetype save shows, pinned at RUNTIME.
//
// The hook resolved a refused registry write through three rungs — the manager's own
// `validation.<code>` (which interpolates params), the shared `errors.<code>` catalog,
// then a generic status — with the server's English `error` string deliberately absent
// from all three. Nothing executed it: the chain was a closure inside the hook, so only
// a rendered manager could reach it, and the rule it enforces (never render the
// server's prose) is exactly the one that regressed on 84 call sites once already.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { validationLabel, type RegistryRefusal } from "./useArchetypeManagerActions.ts";

const SERVER_PROSE = "SqliteError: UNIQUE constraint failed: archetypes.id";

// A translator double over the manager's namespace: only these keys exist.
const messages: Record<string, string> = {
  "validation.weights_sum": "Weights must total 100% (got {total}%)",
  saveFailedStatus: "Could not save ({status})",
};
const t = Object.assign(
  (key: string, params?: Record<string, string | number>) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? `{${k}}`)),
  { has: (key: string) => key in messages }
);
// useErrorMessage's contract: resolve `errors.<code>` in the reader's language, else
// the caller's fallback. It NEVER reads data.error.
const errMsg = (data: RegistryRefusal | null, fallback: string) =>
  data?.code === "known_code" ? "A known failure, in the reader's language" : fallback;

test("a namespace validation key wins, and interpolates its params", () => {
  const label = validationLabel(
    t,
    errMsg,
    { code: "weights_sum", params: { total: 90 }, error: SERVER_PROSE },
    422
  );
  assert.equal(label, "Weights must total 100% (got 90%)");
});

test("a code with no validation key falls through to the shared errors catalog", () => {
  const label = validationLabel(t, errMsg, { code: "known_code", error: SERVER_PROSE }, 409);
  assert.equal(label, "A known failure, in the reader's language");
});

test("an unknown code lands on the generic status line, never the raw error", () => {
  const label = validationLabel(t, errMsg, { code: "never_seen", error: SERVER_PROSE }, 500);
  assert.equal(label, "Could not save (500)");
});

test("a refusal with no code at all still answers with the status line", () => {
  assert.equal(validationLabel(t, errMsg, { error: SERVER_PROSE }, 400), "Could not save (400)");
  assert.equal(validationLabel(t, errMsg, {}, 400), "Could not save (400)");
});

test("the server's English error string is on no rung of the ladder", () => {
  for (const data of [
    { code: "weights_sum", params: { total: 90 }, error: SERVER_PROSE },
    { code: "known_code", error: SERVER_PROSE },
    { code: "never_seen", error: SERVER_PROSE },
    { error: SERVER_PROSE },
  ] satisfies RegistryRefusal[]) {
    assert.equal(validationLabel(t, errMsg, data, 500).includes("SqliteError"), false);
  }
});
