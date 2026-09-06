import { test } from "node:test";
import assert from "node:assert/strict";
import { CODED_REASON_PREFIX, codedReasonDetail, parseCodedReason } from "./coded-reason.ts";

test("a bare code round-trips in the pre-existing shape", () => {
  // automation-run.ts already writes exactly this string; the format must not move under it.
  assert.equal(codedReasonDetail("offerAutoExtended"), "reason:offerAutoExtended");
  assert.equal(codedReasonDetail("offerAutoExtended", {}), "reason:offerAutoExtended");
  assert.deepEqual(parseCodedReason("reason:offerAutoExtended"), { code: "offerAutoExtended", params: {} });
  assert.equal(CODED_REASON_PREFIX, "reason:");
});

test("params round-trip, including values carrying the separator", () => {
  const detail = codedReasonDetail("leadPending", { channel: 'boards: "x" }' });
  assert.deepEqual(parseCodedReason(detail), { code: "leadPending", params: { channel: 'boards: "x" }' } });
  // Numbers are coerced — a reader can only interpolate text.
  assert.deepEqual(parseCodedReason(codedReasonDetail("x", { n: 3 })), { code: "x", params: { n: "3" } });
});

test("legacy details are not ours and parse to null", () => {
  for (const legacy of [
    null,
    undefined,
    "",
    "boards webhook lead — profile pending enrichment",
    "repeat application via quick apply",
    "entry-abc123", // a machine handle (the rematch counterpart)
    "reason:", // no code
    "reason:not_a_code", // codes are letters only
    "reason:with space",
  ]) {
    assert.equal(parseCodedReason(legacy as string | null | undefined), null, String(legacy));
  }
});

test("a malformed params blob still renders its code rather than failing the row", () => {
  assert.deepEqual(parseCodedReason("reason:leadPending:{oops"), { code: "leadPending", params: {} });
  assert.deepEqual(parseCodedReason("reason:leadPending:[1,2]"), { code: "leadPending", params: {} });
  assert.deepEqual(parseCodedReason("reason:leadPending:null"), { code: "leadPending", params: {} });
  // Non-primitive values are dropped; the primitives beside them survive.
  assert.deepEqual(parseCodedReason('reason:x:{"a":"1","b":{"c":2}}'), { code: "x", params: { a: "1" } });
});

test("an invalid code is a WRITER error, refused at the encoder", () => {
  assert.throws(() => codedReasonDetail("re_applied"), /not a valid reason code/);
  assert.throws(() => codedReasonDetail(""), /not a valid reason code/);
});
