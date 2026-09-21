// The reveal contract: which brief lines type themselves out and which just
// appear. Written against the failure that motivated it — the engine re-emits
// the WHOLE brief on every sweep, so anything keyed by position re-animates the
// entire panel each time one line lands.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyReveal, rememberKeys, typeStep, TYPE_MAX_MS, TYPE_TICK_MS } from "./briefReveal.ts";
import { buildBriefSections, sectionLineKeys } from "./briefSections.ts";
import type { RoleBrief } from "@/app/_lib/rolespec";

const req = (over: Partial<NonNullable<RoleBrief["requirements"]>[number]>) => ({
  skill: "Kotlin",
  kind: "must_have" as const,
  weight: 0.8,
  confidence: 0.9,
  provenance: "stated",
  rationale: "",
  sourceTurn: 2,
  hardness: "",
  ...over,
});

const brief = (over: Partial<RoleBrief> = {}): RoleBrief =>
  ({
    title: "Backend engineer",
    requirements: [req({}), req({ skill: "Postgres", kind: "nice_to_have", weight: 0.4 })],
    successCriteria: ["Ships the payments migration in 90 days."],
    facets: [],
    languages: [],
    ...over,
  }) as RoleBrief;

test("first classification treats everything already there as history, not news", () => {
  const keys = sectionLineKeys(buildBriefSections(brief()));
  const modes = classifyReveal(null, keys);
  assert.equal(keys.length, 3);
  assert.deepEqual([...new Set(modes.values())], ["fade"]);
});

test("a line that survives a re-extraction settles instead of re-animating", () => {
  const first = sectionLineKeys(buildBriefSections(brief()));
  const seen = rememberKeys(null, first);
  const modes = classifyReveal(seen, sectionLineKeys(buildBriefSections(brief())));
  assert.deepEqual([...new Set(modes.values())], ["settled"]);
});

test("only the newly landed line types", () => {
  const first = brief();
  const seen = rememberKeys(null, sectionLineKeys(buildBriefSections(first)));
  const grown = brief({ requirements: [...(first.requirements ?? []), req({ skill: "Kafka" })] });
  const modes = classifyReveal(seen, sectionLineKeys(buildBriefSections(grown)));
  const typed = [...modes.entries()].filter(([, m]) => m === "type").map(([k]) => k);
  assert.deepEqual(typed, ["must:kafka"]);
});

test("reordering by weight does not make an unchanged line look new", () => {
  // The engine's weights drift between sweeps and sortByWeight re-orders the
  // list; identity is the sentence, so nothing here is news.
  const before = brief({ requirements: [req({ skill: "Kotlin", weight: 0.9 }), req({ skill: "Kafka", weight: 0.5 })] });
  const after = brief({ requirements: [req({ skill: "Kafka", weight: 0.95 }), req({ skill: "Kotlin", weight: 0.5 })] });
  const seen = rememberKeys(null, sectionLineKeys(buildBriefSections(before)));
  const modes = classifyReveal(seen, sectionLineKeys(buildBriefSections(after)));
  assert.equal([...modes.values()].filter((m) => m === "type").length, 0);
});

test("a line that disappears and comes back is not re-typed", () => {
  const full = brief();
  const seen = rememberKeys(null, sectionLineKeys(buildBriefSections(full)));
  const thinned = brief({ requirements: [req({})] });
  const afterLoss = rememberKeys(seen, sectionLineKeys(buildBriefSections(thinned)));
  const modes = classifyReveal(afterLoss, sectionLineKeys(buildBriefSections(full)));
  assert.equal([...modes.values()].filter((m) => m === "type").length, 0);
});

test("duplicate sentences get distinct but deterministic keys", () => {
  const dup = brief({ successCriteria: ["Same line.", "Same line."] });
  const a = sectionLineKeys(buildBriefSections(dup));
  const b = sectionLineKeys(buildBriefSections(dup));
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test("casing and whitespace noise is not a new line", () => {
  const seen = rememberKeys(null, sectionLineKeys(buildBriefSections(brief())));
  const noisy = brief({ requirements: [req({ skill: "  KOTLIN  " }), req({ skill: "Postgres", kind: "nice_to_have" })] });
  const modes = classifyReveal(seen, sectionLineKeys(buildBriefSections(noisy)));
  assert.equal([...modes.values()].filter((m) => m === "type").length, 0);
});

test("an empty brief has no sections and no keys", () => {
  assert.deepEqual(buildBriefSections(null), []);
  assert.deepEqual(sectionLineKeys(buildBriefSections({ title: "", requirements: [], facets: [], successCriteria: [] } as unknown as RoleBrief)), []);
});

test("facets carry their group in the key, so the same value in two groups is two lines", () => {
  const withFacets = brief({
    facets: [
      { key: "team", label: "Team", value: "Payments", importance: "core", provenance: "stated", confidence: 1, sourceTurn: 3 },
      { key: "mandate", label: "Mandate", value: "Payments", importance: "core", provenance: "inferred", confidence: 0.6, sourceTurn: null },
    ],
  } as unknown as Partial<RoleBrief>);
  const keys = sectionLineKeys(buildBriefSections(withFacets));
  assert.equal(new Set(keys).size, keys.length);
});

test("typing is bounded: a long line types in wider steps, never for longer", () => {
  assert.equal(typeStep(10), 1);
  const long = 4000;
  const ticks = Math.ceil(long / typeStep(long));
  assert.ok(ticks * TYPE_TICK_MS <= TYPE_MAX_MS + TYPE_TICK_MS, `long line would take ${ticks * TYPE_TICK_MS}ms`);
});
