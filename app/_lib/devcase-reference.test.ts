// The candidate-facing submission handle. Pure (node:crypto only), and until now
// untested — which matters because the whole point of the module is a property
// no reader can check by eye: the reference must be ONE-WAY (the internal
// `dev_submissions.id` must not be recoverable from, or equal to, the string
// printed on a public thank-you screen) and STABLE (the candidate quotes it back
// in an email a week later and it still resolves to the same submission).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { submissionReference } from "./devcase-reference.ts";

test("the reference is stable: the same id always produces the same handle", () => {
  const a = submissionReference("sub_x7abc");
  assert.equal(a, submissionReference("sub_x7abc"));
  assert.equal(a, submissionReference("sub_x7abc"), "and again — no salt, no clock, no counter");
});

test("the shape is `ref-` + 10 lowercase hex, so it is quotable by a human", () => {
  for (const id of ["sub_x7abc", "1", "", "a".repeat(500), "sub/with spaces & symbols…"]) {
    const ref = submissionReference(id);
    assert.match(ref, /^ref-[0-9a-f]{10}$/, `${JSON.stringify(id)} → ${ref}`);
  }
});

test("it is ONE-WAY: the reference neither is nor contains the submission id", () => {
  // The bug this module closed: both public intake doors echoed the raw store
  // key, and `POST /api/devcase/skill-profile` accepted that key as its only
  // argument. A reference that leaked the id back would reopen it.
  for (const id of ["sub_x7abc", "sub-0000000000", "abcdef0123"]) {
    const ref = submissionReference(id);
    assert.notEqual(ref, id);
    assert.ok(!ref.includes(id), `${ref} must not carry ${id}`);
  }
});

test("distinct ids get distinct references, including ids that differ by one character", () => {
  assert.notEqual(submissionReference("sub_a"), submissionReference("sub_b"));
  assert.notEqual(submissionReference("sub_1"), submissionReference("sub_10"));
  const refs = new Set(Array.from({ length: 500 }, (_, i) => submissionReference(`sub_${i}`)));
  assert.equal(refs.size, 500, "500 ids, 500 references — 10 hex chars leaves collisions vanishingly rare");
});

test("the domain separator is part of the hash, so this is not a bare sha256 of the id", () => {
  // Pinning the prefix keeps the handle from colliding with any other digest the
  // product prints (the session watermark shares the shape, not the input).
  const bare = `ref-${createHash("sha256").update("sub_x7abc", "utf8").digest("hex").slice(0, 10)}`;
  assert.notEqual(submissionReference("sub_x7abc"), bare);
  const domained = `ref-${createHash("sha256").update("kp-devcase-ref|sub_x7abc", "utf8").digest("hex").slice(0, 10)}`;
  assert.equal(submissionReference("sub_x7abc"), domained);
});
