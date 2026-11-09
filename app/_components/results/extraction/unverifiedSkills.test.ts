import { test } from "node:test";
import assert from "node:assert/strict";
import { unverifiedExplanationSkills } from "./unverifiedSkills";
import { EXPLANATION_UNVERIFIED_SKILL_CODE } from "@/app/_lib/reasons-coverage";

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

test("the local copy of the finding code is the one reasons-coverage declares", () => {
  assert.equal(unverifiedExplanationSkills([{ code: EXPLANATION_UNVERIFIED_SKILL_CODE, value: "go" }]), "go");
});
