// applicantKey (applicant-key.ts) — the erasable, hashed dedupe identity an inbound
// filing is stored under (pipeline_entries.applicant_key). It replaced applyDedupeKey,
// which wrote the normalized email IN CLEAR into the entry's primary key
// (`m-appl-jane-example-com-<job>`), an id exported to ATSs, sealed into the decision
// chain and printed in logs. Challenge r06 candidate-apply-flow/A.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicantKey } from "./applicant-key.ts";

test("one applicant, one key: casing and spacing variants collapse; the key is an opaque hex digest", () => {
  const a = applicantKey("Jane Doe", "Jane@Example.com");
  const b = applicantKey("jane  doe", " jane@example.com ");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{32,64}$/);
  assert.doesNotMatch(a, /jane/i, "the key never carries the name");
  assert.doesNotMatch(a, /example/i, "the key never carries the address");
});

test("anonymous and address-less never dedupes; email and name keys are domain-separated", () => {
  assert.equal(applicantKey("", null), "", "an anonymous, address-less applicant has no identity to key on");
  assert.equal(applicantKey("   ", "   "), "");
  assert.notEqual(applicantKey("Jane Doe", null), applicantKey("Jane Doe", "jane@x.invalid"));
  assert.notEqual(applicantKey("Jane Doe", null), "");
  // The email is the stronger identity: a different display name with the same address
  // is the same applicant; the same name with a different address is not.
  assert.equal(applicantKey("Jane Doe", "jane@x.invalid"), applicantKey("Jane D.", "JANE@x.invalid"));
  assert.notEqual(applicantKey("Jane Doe", "jane1@x.invalid"), applicantKey("Jane Doe", "jane2@x.invalid"));
  // a.b@x and ab@x stay distinct (the old slug strip needed a trick for this).
  assert.notEqual(applicantKey("X", "a.b@x.com"), applicantKey("X", "ab@x.com"));
});
