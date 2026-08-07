import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FEEDBACK_LINES, buildRejectionFeedback, renderRejectionFeedback } from "./rejection-feedback.ts";

const gaps = (...labels: string[]) => labels.map((label, i) => ({ check: `c${i}`, label }));

test("recorded checklist gaps become the feedback, and say so", () => {
  const fb = buildRejectionFeedback({ profileGaps: gaps("No hands-on Kubernetes experience", "No Czech at B2") });
  assert.deepEqual(fb.lines, ["No hands-on Kubernetes experience", "No Czech at B2"]);
  assert.equal(fb.source, "recorded_gaps");
  assert.equal(fb.filtered, false);
});

test("recorded gaps WIN over derived unmet requirements", () => {
  // The checklist is what a human actually asked for; the match run's unmet list is
  // derived. When both exist the candidate should hear the human's criteria.
  const fb = buildRejectionFeedback({
    profileGaps: gaps("No payments-domain experience"),
    unmetRequirements: ["Kafka", "Terraform"],
  });
  assert.equal(fb.source, "recorded_gaps");
  assert.deepEqual(fb.lines, ["No payments-domain experience"]);
});

test("with nothing recorded there is NO feedback — silence beats invention", () => {
  // The caller then ships today's template unchanged. A fabricated reason in an adverse
  // comm is the single worst thing this feature could do.
  assert.deepEqual(buildRejectionFeedback({}), { lines: [], source: "none", filtered: false });
  assert.equal(buildRejectionFeedback({ profileGaps: [], unmetRequirements: [] }).source, "none");
  assert.equal(buildRejectionFeedback({ profileGaps: gaps("", "   ") }).source, "none");
});

test("a line mentioning a protected attribute is DROPPED WHOLE, not redacted", () => {
  // A partially-scrubbed sentence about someone's age is still a sentence about their age.
  const fb = buildRejectionFeedback({
    profileGaps: gaps("Too close to retirement age for a graduate track", "No hands-on Kubernetes experience"),
  });
  assert.deepEqual(fb.lines, ["No hands-on Kubernetes experience"]);
  assert.equal(fb.filtered, true, "the recruiter must be able to see the filter fired");
});

test("the filter covers Czech, the primary market's language", () => {
  const fb = buildRejectionFeedback({ profileGaps: gaps("Nemá potřebné občanství", "Chybí zkušenost s Kafkou") });
  assert.deepEqual(fb.lines, ["Chybí zkušenost s Kafkou"]);
  assert.equal(fb.filtered, true);
});

test("if EVERY line is filtered, the result is no-feedback and not an empty section", () => {
  const fb = buildRejectionFeedback({ profileGaps: gaps("Maternity gap in the CV") });
  assert.equal(fb.source, "none");
  assert.deepEqual(fb.lines, []);
  assert.equal(fb.filtered, true);
  assert.equal(renderRejectionFeedback(fb, "Here is what stood out:", "Thanks."), "");
});

test("a filtered gap list does NOT silently fall through to the derived list", () => {
  // Falling through would route around the filter: the same protected signal often
  // appears in both lists, so a drop on one must not be rescued by the other.
  const fb = buildRejectionFeedback({
    profileGaps: gaps("Career break for childcare"),
    unmetRequirements: ["Kafka"],
  });
  assert.equal(fb.source, "none");
  assert.equal(fb.filtered, true);
});

test("output is capped, de-duplicated and trimmed", () => {
  const fb = buildRejectionFeedback({ profileGaps: gaps("A", "a", "B", "C", "D", "E") });
  assert.equal(fb.lines.length, MAX_FEEDBACK_LINES, "more than three bullets reads as a case being built");
  assert.deepEqual(fb.lines, ["A", "B", "C"]);

  const long = buildRejectionFeedback({ profileGaps: gaps("x".repeat(500)) });
  assert.ok(long.lines[0].length <= 140);
  assert.ok(long.lines[0].endsWith("…"));

  const messy = buildRejectionFeedback({ profileGaps: gaps("  spaced   out\n\tline  ") });
  assert.deepEqual(messy.lines, ["spaced out line"]);
});

test("rendering wraps the bullets in the caller's localized sentences", () => {
  const fb = buildRejectionFeedback({ profileGaps: gaps("No Kafka") });
  const out = renderRejectionFeedback(fb, "Where we landed:", "We keep your profile on file.");
  assert.match(out, /Where we landed:/);
  assert.match(out, /• No Kafka/);
  assert.match(out, /We keep your profile on file\./);
});
