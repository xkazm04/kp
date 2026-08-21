// Pins Direction 2 — "one bad CV never kills the batch": with settled semantics,
// N−1 successful variants still DELIVER a result (winner picked among successes)
// and the failed variant is NAMED in the outcome; only a total wipeout throws.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { cvHashForLabel, settleVariants, type VariantResult } from "./analyze-run.ts";
import type { Analysis } from "./schemas.ts";

const ok = (label: string, cached = false): VariantResult => ({
  label,
  ok: true,
  cached,
  analysis: { candidate: { name: label } } as unknown as Analysis,
});
const fail = (label: string, error = "boom", status = 502): VariantResult => ({ label, ok: false, error, status });
// A failure whose reason was OUR OWN generic fallback (no engine text) — carries a
// stable `code` so the client localizes rather than showing an English literal.
const codedFail = (label: string, code = "analyzeVariantFailed", status = 500): VariantResult => ({
  label,
  ok: false,
  error: `internal fallback for "${label}"`,
  code,
  status,
});

// ── The regression: one failing variant no longer discards its good siblings ──
test("2 good + 1 bad delivers the two successes and names the failure", () => {
  const d = settleVariants([ok("a.pdf"), fail("b.pdf", "Pipeline returned non-JSON output"), ok("c.pdf")]);
  assert.equal(d.kind, "deliver");
  if (d.kind !== "deliver") return;
  assert.deepEqual(
    d.successes.map((s) => s.label),
    ["a.pdf", "c.pdf"],
    "both good variants survive — the bad one didn't kill the batch",
  );
  assert.deepEqual(d.partialFailures, [{ label: "b.pdf", error: "Pipeline returned non-JSON output" }]);
});

// ── Single-CV failure behavior unchanged: engine text still rides the throw ────
test("a lone failing variant throws with its engine error + status (single-CV unchanged)", () => {
  const d = settleVariants([fail("only.pdf", "extraction failed", 400)]);
  // Engine text (no code) is the client-facing `error`; `logError` mirrors it.
  assert.deepEqual(d, { kind: "throw", error: "extraction failed", logError: "extraction failed", status: 400 });
});

// ── Total wipeout (multi) throws with the FIRST failure's error ───────────────
test("every variant failing throws (surfacing the first failure)", () => {
  const d = settleVariants([fail("a", "err-a", 502), fail("b", "err-b", 500)]);
  assert.deepEqual(d, { kind: "throw", error: "err-a", logError: "err-a", status: 502 });
});

// ── A CODED wipeout (our own fallback, no engine text) throws EMPTY client text ─
// so the client renders its localized message instead of an English literal, while
// the server log still keeps a non-empty detail.
test("a coded total wipeout throws with empty client error but a logged detail", () => {
  const d = settleVariants([codedFail("only.pdf")]);
  assert.equal(d.kind, "throw");
  if (d.kind !== "throw") return;
  assert.equal(d.error, "", "no English literal leaks to the client");
  assert.ok(d.logError.length > 0, "the server log keeps a detail");
  assert.equal(d.status, 500);
});

// ── A partial delivery carries the failure's code so the client can localize it ─
test("partial delivery threads a coded failure's code through to the client", () => {
  const d = settleVariants([ok("a.pdf"), codedFail("b.pdf")]);
  assert.equal(d.kind, "deliver");
  if (d.kind !== "deliver") return;
  assert.deepEqual(d.partialFailures, [
    { label: "b.pdf", error: 'internal fallback for "b.pdf"', code: "analyzeVariantFailed" },
  ]);
});

// ── Billing: exactly one delivered run; allCached only when EVERY success cached
test("allCached reflects the delivered successes, not the failures", () => {
  // A failed variant must not force a debit on an otherwise all-cached delivery.
  const bothCached = settleVariants([ok("a", true), fail("b"), ok("c", true)]);
  assert.equal(bothCached.kind === "deliver" && bothCached.allCached, true, "all surviving successes cached → no debit");
  const oneFresh = settleVariants([ok("a", true), ok("c", false)]);
  assert.equal(oneFresh.kind === "deliver" && oneFresh.allCached, false, "a non-cached success → debit one");
});

// ── Identity follows the DELIVERED variant, never variants[0] ────────────────
// Settled semantics retired the invariant "one delivered analysis ⇒ one submitted
// variant". A 2-CV run whose FIRST variant fails extraction still delivers the
// second, and the persisted row must carry the SURVIVOR's content hash: cv_hash is
// the content-addressed candidate identity History groups on (listAnalyses), the
// cross-job "also analyzed for" list joins on (listAnalysesByCvHash), and a profile
// built from the report stamps as CV lineage (analysisLineageSource). Stamping the
// FAILED file's hash sends all three to the wrong CV.
test("the persisted cv hash follows the delivered variant, not the first submitted one", () => {
  const variants = [
    { label: "jana_cv_2024.pdf", cvHash: "HASH_2024" },
    { label: "jana_cv_2026.pdf", cvHash: "HASH_2026" },
  ];
  // The 2024 scan is an image-only PDF: extraction fails. The 2026 CV delivers.
  const d = settleVariants([fail("jana_cv_2024.pdf", "extraction failed", 400), ok("jana_cv_2026.pdf")]);
  assert.equal(d.kind, "deliver");
  if (d.kind !== "deliver") return;
  assert.equal(d.successes.length, 1, "one survivor — this takes analyze-run's single-analysis persist path");
  const delivered = d.successes[0].label;
  assert.equal(cvHashForLabel(variants, delivered), "HASH_2026", "the surviving CV's own hash");
  assert.notEqual(
    cvHashForLabel(variants, delivered),
    variants[0].cvHash,
    "never the FAILED first variant's hash (the pre-fix `p.variants[0]?.cvHash`)",
  );
});

test("cvHashForLabel is undefined when no variant carries the label (never a stray hash)", () => {
  assert.equal(cvHashForLabel([{ label: "a.pdf", cvHash: "H" }], "b.pdf"), undefined);
  assert.equal(cvHashForLabel([{ label: "a.pdf" }], "a.pdf"), undefined, "a hash-less variant stays hash-less");
});

// ── A clean run reports no partial failures ──────────────────────────────────
test("all-success run has an empty partialFailures list", () => {
  const d = settleVariants([ok("a"), ok("b")]);
  assert.equal(d.kind === "deliver" && d.partialFailures.length, 0);
});
