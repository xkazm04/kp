// Pins the "a response body is not necessarily JSON" fold (lot JW, wave 22).
//
// Two fetches in this context awaited `r.json()` bare while every sibling fetch
// in the same files already wrote `.json().catch(() => null)`. A proxy or a
// dev-server hiccup answers an HTML 502, `r.json()` throws a SyntaxError, and
// that raw parser message — "Unexpected token '<'…" — was painted into the
// recruiter's panel as the failure reason, in English, in every locale.
//
// A 200 whose body is missing the field the surface needs is the same class of
// event: the request did not fail, but there is nothing to render. It must
// answer a localized line of its own, not be mistaken for a well-formed refusal
// (which would resolve `errors.<code>` off a body that has no code).
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldJsonResponse } from "./jobsResponseFold.ts";

type Payload = { candidates: unknown[] };
const hasCandidates = (p: object) => Array.isArray((p as { candidates?: unknown }).candidates);

test("an unparseable body on a 200 folds to malformed, never to ok", () => {
  // `.json().catch(() => null)` hands the fold a null — pre-fix this threw.
  const f = foldJsonResponse<Payload>({ ok: true, status: 200 }, null, hasCandidates);
  assert.equal(f.kind, "malformed");
});

test("a 200 whose body lacks the field the surface needs is malformed", () => {
  const f = foldJsonResponse<Payload>({ ok: true, status: 200 }, { note: "ok" }, hasCandidates);
  assert.equal(f.kind, "malformed");
});

test("a well-formed 200 folds to ok and carries the payload through", () => {
  const body = { candidates: [{ candidateId: "c1" }] };
  const f = foldJsonResponse<Payload>({ ok: true, status: 200 }, body, hasCandidates);
  assert.equal(f.kind, "ok");
  if (f.kind !== "ok") return;
  assert.equal(f.data, body);
});

test("a refusal keeps its code so the caller can resolve errors.<code>", () => {
  const f = foldJsonResponse<Payload>({ ok: false, status: 402 }, { error: "Quota exceeded", code: "BILLING_QUOTA_EXCEEDED" }, hasCandidates);
  assert.equal(f.kind, "failed");
  if (f.kind !== "failed") return;
  assert.equal(f.payload?.code, "BILLING_QUOTA_EXCEEDED");
  assert.equal(f.status, 402);
});

test("an unparseable body on a NON-ok status stays a failure (status is the fact we have)", () => {
  // Order matters: an HTML 502 must read as "the request failed (502)", not as
  // "the body was odd" — the status is the only true thing in the exchange.
  const f = foldJsonResponse<Payload>({ ok: false, status: 502 }, null, hasCandidates);
  assert.equal(f.kind, "failed");
  if (f.kind !== "failed") return;
  assert.equal(f.payload, null);
  assert.equal(f.status, 502);
});

test("a non-object body (a bare JSON string) is malformed, not a payload", () => {
  const f = foldJsonResponse<Payload>({ ok: true, status: 200 }, "gateway timeout", hasCandidates);
  assert.equal(f.kind, "malformed");
});
