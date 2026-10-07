import { test } from "node:test";
import assert from "node:assert/strict";
import { unverifiedExplanationSkills } from "./unverifiedSkills";

test("the marker names the skills the engine coded, and only then", () => {
  assert.equal(
    unverifiedExplanationSkills([
      { code: "explanation_fallback", value: null },
      { code: "explanation_unverified_skill", value: " terraform, kubernetes " },
    ]),
    "terraform, kubernetes"
  );
  assert.equal(unverifiedExplanationSkills([{ code: "explanation_fallback" }]), null);
  assert.equal(unverifiedExplanationSkills([{ code: "explanation_unverified_skill", value: "  " }]), null);
  assert.equal(unverifiedExplanationSkills(undefined), null);
});
