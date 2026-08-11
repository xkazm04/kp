import { strict as assert } from "node:assert";
import test from "node:test";
import { LLM_USE_CASES } from "@/app/_lib/llm-config";
import { OTHER_SECTION_KEY, ROUTING_SECTIONS, sectionizeUseCases } from "./modelsRoutingSections";

test("every routing use case is placed in exactly one section", () => {
  const seen = new Map<string, string>();
  for (const section of ROUTING_SECTIONS) {
    for (const useCase of section.useCases) {
      assert.equal(
        seen.get(useCase),
        undefined,
        `${useCase} appears in both ${seen.get(useCase)} and ${section.key}`
      );
      seen.set(useCase, section.key);
    }
  }
  // Exact parity with the catalog: an unplaced use case would render in the
  // anonymous "other" bucket; a stale section member would be dead config.
  assert.deepEqual([...seen.keys()].sort(), [...LLM_USE_CASES].sort());
});

test("sectionize preserves curated order and drops empty sections", () => {
  const result = sectionizeUseCases(["automation", "match_reasoning", "*"]);
  assert.deepEqual(result, [
    { key: "default", useCases: ["*"] },
    { key: "matching", useCases: ["match_reasoning"] },
    { key: "automation", useCases: ["automation"] },
  ]);
});

test("unknown server use cases land in a trailing 'other' bucket", () => {
  const result = sectionizeUseCases(["*", "brand_new_case"]);
  assert.deepEqual(result, [
    { key: "default", useCases: ["*"] },
    { key: OTHER_SECTION_KEY, useCases: ["brand_new_case"] },
  ]);
});
