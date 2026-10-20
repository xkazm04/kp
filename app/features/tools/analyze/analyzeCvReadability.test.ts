// Preflight: what the engine can read of every attached Analyze file, decided
// BEFORE the run spends anything.
//
// The engine already refuses a blind run on a CV with no text layer
// (pipeline.py's blind halt -> gemini.py `blind_unavailable`), but the recruiter
// only learns it from a failed task — and in a multi-CV compare the scanned
// variant is dropped by settleVariants AFTER the other engine calls have spent.
// /api/extract-text already answers {text, charCount, pageCount}; these cases pin
// the pure decision the Analyze footer makes from those counts.
//
// Runner:
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeCvReadability.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THIN_CHARS,
  createReadabilityCache,
  measureFile,
  preflightVerdict,
  readabilityFromExtract,
  type Readability,
} from "./analyzeCvReadability.ts";

const readable: Readability = { kind: "readable", chars: 4120, pages: 2 };
const noText: Readability = { kind: "no-text", pages: 2 };
const unchecked: Readability = { kind: "unchecked" };

test("case 1: a zero-char extract is a missing text layer; a full one is readable", () => {
  assert.deepEqual(readabilityFromExtract({ ok: true, charCount: 0, pageCount: 2 }), { kind: "no-text", pages: 2 });
  assert.deepEqual(readabilityFromExtract({ ok: true, charCount: 4120, pageCount: 2 }), {
    kind: "readable",
    chars: 4120,
    pages: 2,
  });
});

test("case 2: under the engine's own short-profile bar (120 chars) the text is thin", () => {
  assert.equal(THIN_CHARS, 120);
  const thin = readabilityFromExtract({ ok: true, charCount: 80, pageCount: 1 });
  assert.equal(thin.kind, "thin");
  assert.equal(thin.kind === "thin" && thin.chars, 80);
  // The bar itself is not thin — the engine flags UNDER 120.
  assert.equal(readabilityFromExtract({ ok: true, charCount: 120, pageCount: 1 }).kind, "readable");
});

test("case 3: a rate limit, a timeout or a network throw is unknown; a 4xx refusal is unreadable", () => {
  assert.deepEqual(readabilityFromExtract({ ok: false, status: 429 }), { kind: "unchecked" });
  assert.deepEqual(readabilityFromExtract({ ok: false, status: 504 }), { kind: "unchecked" });
  assert.deepEqual(readabilityFromExtract({ ok: false, status: 503, code: "ENGINE_BUSY" }), { kind: "unchecked" });
  assert.deepEqual(readabilityFromExtract(null), { kind: "unchecked" });
  assert.deepEqual(readabilityFromExtract({ ok: false, status: 400, code: "EXTRACT_TEXT_UNREADABLE" }), {
    kind: "unreadable",
  });
});

test("case 4: blind + a CV with no text layer blocks, names the CV and offers both remedies", () => {
  const v = preflightVerdict({ blind: true, cvs: [readable, noText], jd: null });
  assert.equal(v.blockRun, true);
  assert.deepEqual(v.blindUnmaskable, [1]);
  assert.deepEqual(v.remedies, ["disable-blind", "remove-variant"]);
  // Fail closed: an unreadable document cannot be masked either.
  const u = preflightVerdict({ blind: true, cvs: [{ kind: "unreadable" }], jd: null });
  assert.equal(u.blockRun, true);
  assert.deepEqual(u.blindUnmaskable, [0]);
});

test("case 5: without blind the model reads the file itself, so a scan is a note, not a block", () => {
  const v = preflightVerdict({ blind: false, cvs: [noText], jd: null });
  assert.equal(v.blockRun, false);
  assert.deepEqual(v.notes, [{ cv: 0, kind: "model-read" }]);
  assert.deepEqual(v.blindUnmaskable, []);
  assert.deepEqual(v.remedies, []);
});

test("case 6: an unknown never blocks a run (degrade, never block)", () => {
  const v = preflightVerdict({ blind: true, cvs: [unchecked], jd: null });
  assert.equal(v.blockRun, false);
  assert.deepEqual(v.blindUnmaskable, []);
});

test("case 7: an empty JD file is named — and named louder when it overrides pasted text", () => {
  const typed = preflightVerdict({ blind: false, cvs: [readable], jd: { kind: "no-text", pages: 1 }, jdTextTyped: true });
  assert.deepEqual(typed.notes, [{ jd: true, kind: "jd-file-empty-overrides-text" }]);
  assert.equal(typed.blockRun, false);
  const bare = preflightVerdict({ blind: false, cvs: [readable], jd: { kind: "no-text", pages: 1 }, jdTextTyped: false });
  assert.deepEqual(bare.notes, [{ jd: true, kind: "jd-file-empty" }]);
});

function fetchSpy(answer: () => Response) {
  const calls: unknown[] = [];
  const fn = (async (...args: unknown[]) => {
    calls.push(args);
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

test("case 8: text files are measured locally; byte-identical PDFs cost one extract call", async () => {
  const spy = fetchSpy(
    () => new Response(JSON.stringify({ text: "x".repeat(900), charCount: 900, pageCount: 1 }), { status: 200 }),
  );
  const cache = createReadabilityCache();

  const txt = new File(["hello ".repeat(40)], "cv.txt", { type: "text/plain" });
  const md = new File(["# Short"], "cv.md", { type: "" });
  assert.deepEqual(await measureFile(txt, { fetch: spy.fn, cache }), { kind: "readable", chars: 240, pages: null });
  assert.equal((await measureFile(md, { fetch: spy.fn, cache })).kind, "thin");
  assert.equal(spy.calls.length, 0);

  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3]);
  const a = new File([bytes], "a.pdf", { type: "application/pdf" });
  const b = new File([bytes], "b.pdf", { type: "application/pdf" });
  const [ra, rb] = await Promise.all([measureFile(a, { fetch: spy.fn, cache }), measureFile(b, { fetch: spy.fn, cache })]);
  assert.deepEqual(ra, { kind: "readable", chars: 900, pages: 1 });
  assert.deepEqual(rb, ra);
  assert.equal(spy.calls.length, 1);
});

test("case 8b: a network throw measures as unchecked and is not cached", async () => {
  let calls = 0;
  const failing = (async () => {
    calls += 1;
    throw new TypeError("network down");
  }) as typeof fetch;
  const cache = createReadabilityCache();
  const pdf = new File([new Uint8Array([1, 2, 3])], "scan.pdf", { type: "application/pdf" });
  assert.deepEqual(await measureFile(pdf, { fetch: failing, cache }), { kind: "unchecked" });
  assert.deepEqual(await measureFile(pdf, { fetch: failing, cache }), { kind: "unchecked" });
  assert.equal(calls, 2, "an unknown answer is retried, never remembered");
});
