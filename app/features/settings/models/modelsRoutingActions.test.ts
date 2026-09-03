// The routing table's two fetch wrappers were the untested half of the Models tab:
// every branch that decides whether a save COUNTED — the ok path, a plain failure, a
// network throw, and now the 409 that answers WITH the current rows — was reachable
// only through the UI.
//
// The stale branch is the one that matters. The route re-asserts the version the row
// was composed against and refuses a superseded save; the wrapper has to (a) surface
// the localized message and (b) hand the caller the rows the refusal carried, or the
// operator is left looking at a dead draft with nothing to reload from.
//
// Runner: node --test with type stripping (no DOM, no next-intl). `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetRoutingPin, saveRoutingPin } from "./modelsRoutingActions.ts";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";

const ROW = { useCase: "match_reasoning", provider: "openai", model: "gpt-4o", params: {}, updatedAt: "2026-09-01T10:00:00.000Z" };

/** Stands in for useErrorMessage(): resolves the machine code, never the server's
 *  `error` string — which is exactly the contract the real resolver holds. */
const errMsg: ErrorMessageResolver = (body, fallback) =>
  body && typeof body === "object" && "code" in body && typeof body.code === "string" ? `resolved:${body.code}` : fallback;

type Call = { url: string; init: RequestInit };
function stubFetch(status: number, payload: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

test("saveRoutingPin SENDS the version it was composed against", async () => {
  const calls = stubFetch(200, { ok: true, rows: [ROW] });
  const result = await saveRoutingPin("match_reasoning", "openai", " gpt-4o ", { maxTokens: 8 }, ROW.updatedAt, "fallback", errMsg);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "/api/llm/config");
  const body = sentBody(calls[0]);
  assert.equal(body.expectedUpdatedAt, ROW.updatedAt, "without this the store cannot refuse a stale save");
  assert.equal(body.model, "gpt-4o", "trimmed");
  assert.deepEqual(body.params, { maxTokens: 8 }, "headless params are carried through, never dropped");
});

test("an EMPTY model box sends null, not an empty string", async () => {
  const calls = stubFetch(200, { ok: true, rows: [ROW] });
  await saveRoutingPin("match_reasoning", "openai", "   ", undefined, null, "fallback", errMsg);
  const body = sentBody(calls[0]);
  assert.equal(body.model, null);
  assert.equal(body.expectedUpdatedAt, null, "'I saw no pin here' travels as null, not as absent");
  assert.deepEqual(body.params, {});
});

test("THE 409: a stale save surfaces the resolved message AND the rows to reload from", async () => {
  stubFetch(409, { error: "english prose the client must not render", code: "MODEL_ROUTING_STALE", rows: [ROW] });
  const result = await saveRoutingPin("match_reasoning", "gemini", "x", undefined, "2026-08-01T00:00:00.000Z", "fallback", errMsg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.message, "resolved:MODEL_ROUTING_STALE", "the CODE, never the server's English");
  assert.deepEqual(result.ok === false && result.rows, [ROW], "the refusal's own payload is the reload affordance");
});

test("a plain failure carries NO rows — nothing new is known, so nothing is applied", async () => {
  stubFetch(403, { error: "nope", code: "MODEL_ADMIN_FORBIDDEN" });
  const result = await saveRoutingPin("match_reasoning", "gemini", "x", undefined, null, "fallback", errMsg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.message, "resolved:MODEL_ADMIN_FORBIDDEN");
  assert.equal(result.ok === false && result.rows, undefined, "a forbidden save must never re-render the table as if it changed");
});

test("a 200 whose body carries no rows is still a failure, not a silent green", async () => {
  stubFetch(200, { ok: true });
  const result = await saveRoutingPin("match_reasoning", "gemini", "x", undefined, null, "fallback", errMsg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.message, "fallback");
});

test("a network throw resolves to the fallback rather than escaping the wrapper", async () => {
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const result = await saveRoutingPin("match_reasoning", "gemini", "x", undefined, null, "fallback", errMsg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.message, "offline");
});

test("resetRoutingPin DELETEs the use case and returns the fresh table", async () => {
  const calls = stubFetch(200, { ok: true, removed: true, rows: [] });
  const result = await resetRoutingPin("match_reasoning", "fallback", errMsg);
  assert.equal(calls[0].init.method, "DELETE");
  assert.deepEqual(sentBody(calls[0]), { useCase: "match_reasoning" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok === true && result.rows, []);
});

test("a refused reset resolves by code", async () => {
  stubFetch(403, { error: "nope", code: "MODEL_ADMIN_FORBIDDEN" });
  const result = await resetRoutingPin("match_reasoning", "fallback", errMsg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.message, "resolved:MODEL_ADMIN_FORBIDDEN");
});
