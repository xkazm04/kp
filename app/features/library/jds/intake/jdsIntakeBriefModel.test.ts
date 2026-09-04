// The live-brief model — the rules the panel's three bodies share. Every case
// below is a shape observed in a real stored brief (data/kp*.sqlite,
// role_intakes.brief_json), not an invented one: the de-duplication exists
// because the engine really does emit the same sentence twice.

import test from "node:test";
import assert from "node:assert/strict";
import {
  briefItemCount,
  importanceRank,
  isNearDuplicate,
  prepareFacets,
  provenanceTone,
  sortByWeight,
  trimLabelPrefix,
  weightBand,
} from "./jdsIntakeBriefModel.ts";
import type { RoleBrief } from "@/app/_lib/rolespec";

const facet = (over: Partial<NonNullable<RoleBrief["facets"]>[number]>) => ({
  key: "why_now",
  label: "Why now",
  value: "A backfill.",
  importance: "core",
  provenance: "stated",
  confidence: 0.9,
  sourceTurn: null,
  ...over,
});

test("provenanceTone folds anything unknown to the most cautious reading", () => {
  assert.equal(provenanceTone("stated"), "stated");
  assert.equal(provenanceTone("inferred"), "inferred");
  assert.equal(provenanceTone("default"), "default");
  assert.equal(provenanceTone(undefined), "default");
  assert.equal(provenanceTone("something-new"), "default");
});

test("weightBand maps onto the shared score bands", () => {
  assert.equal(weightBand(0.9), "strong");
  assert.equal(weightBand(0.8), "strong");
  assert.equal(weightBand(0.7), "mid");
  assert.equal(weightBand(0.5), "mid");
  assert.equal(weightBand(0.4), "weak");
  assert.equal(weightBand(null), "weak");
});

test("sortByWeight is heaviest-first and stable within a tie", () => {
  const items = [
    { skill: "Spring", weight: 0.7 },
    { skill: "Kafka", weight: 0.7 },
    { skill: "Java", weight: 0.9 },
    { skill: "Docker", weight: undefined },
  ];
  assert.deepEqual(
    sortByWeight(items).map((i) => i.skill),
    ["Java", "Spring", "Kafka", "Docker"]
  );
  // The input array is not mutated — two bodies sort the same array per render.
  assert.equal(items[0].skill, "Spring");
});

test("importanceRank grades the engine's three tiers, unknown sits with valuable", () => {
  assert.ok(importanceRank("core") < importanceRank("valuable"));
  assert.ok(importanceRank("valuable") < importanceRank("context"));
  assert.equal(importanceRank("brand-new"), importanceRank("valuable"));
});

test("isNearDuplicate catches the same sentence carrying different connectives", () => {
  // Live pair: successCriteria[0] vs the success_90d facet on the same brief.
  assert.ok(
    isNearDuplicate(
      "Do 90 dnů převezme Jardovy služby a on-call rotace běží bez výpadků",
      "Převezme Jardovy služby, on-call rotace běží bez výpadků"
    )
  );
  assert.ok(isNearDuplicate("gate pass rate — 95% within 60 days", "gate pass rate - 95% within 60 days"));
});

test("isNearDuplicate does not merge two different commitments", () => {
  assert.ok(
    !isNearDuplicate("gate pass rate — 95% within 60 days", "proposal merge rate — 80% within 60 days")
  );
  // Short values can never swallow each other on coincidence — the token path
  // is gated at 5 tokens, so these two fall through to the exact-match test.
  assert.ok(!isNearDuplicate("Rung 0", "Rung 2"));
  assert.ok(!isNearDuplicate("Praha", "Brno"));
});

test("isNearDuplicate still matches short values when they are exactly equal", () => {
  assert.ok(isNearDuplicate("Praha.", "praha"));
});

test("trimLabelPrefix removes the label the engine repeats inside the value", () => {
  assert.equal(trimLabelPrefix("gate pass rate", "gate pass rate — 95% within 60 days"), "95% within 60 days");
  assert.equal(trimLabelPrefix("Probation", "Probation: 14 days"), "14 days");
  // Nothing to trim, and never trim the value down to nothing.
  assert.equal(trimLabelPrefix("Team", "Platební tým"), "Platební tým");
  assert.equal(trimLabelPrefix("Praha", "Praha"), "Praha");
});

test("prepareFacets drops the facet that repeats a 90-day criterion", () => {
  const brief = {
    successCriteria: ["Do 90 dnů převezme Jardovy služby a on-call rotace běží bez výpadků"],
    facets: [
      facet({ key: "team_context", label: "Tým", value: "Platební tým" }),
      facet({ key: "success_90d", label: "Úspěch po 90 dnech", value: "Převezme Jardovy služby, on-call rotace běží bez výpadků" }),
    ],
  } as RoleBrief;
  const groups = prepareFacets(brief);
  const keys = groups.flatMap((g) => g.items.map((i) => i.key));
  assert.deepEqual(keys, ["team_context"]);
});

test("prepareFacets keeps two answers under one key when they differ", () => {
  // Live shape: why_now asked twice, answered twice.
  const brief = {
    facets: [
      facet({ key: "why_now", value: "Backfill — odchod stávajícího seniora." }),
      facet({ key: "why_now", value: "přeskočit" }),
    ],
  } as RoleBrief;
  assert.equal(prepareFacets(brief)[0].items.length, 2);
});

test("prepareFacets drops an exact repeat of a facet it already kept", () => {
  const brief = {
    facets: [facet({ key: "team_context", value: "Platební tým" }), facet({ key: "team_context", value: "Platební tým." })],
  } as RoleBrief;
  assert.equal(prepareFacets(brief)[0].items.length, 1);
});

test("prepareFacets drops a facet that only restates the role's own spine", () => {
  const brief = {
    title: "Senior Java vývojář",
    seniority: "senior",
    facets: [facet({ key: "role.title", value: "Senior Java vývojář" }), facet({ key: "why_now", value: "Backfill." })],
  } as RoleBrief;
  const keys = prepareFacets(brief).flatMap((g) => g.items.map((i) => i.key));
  assert.deepEqual(keys, ["why_now"]);
});

test("prepareFacets groups by key namespace and orders items by importance", () => {
  const brief = {
    facets: [
      facet({ key: "codebase_dossier.maintainer_load", importance: "context", value: "2 authors" }),
      facet({ key: "codebase_dossier.stack", importance: "core", value: "TypeScript, Python" }),
      facet({ key: "mandate.owner", value: "Michal reviews every proposal." }),
      facet({ key: "why_now", value: "Gates keep going red." }),
    ],
  } as RoleBrief;
  const groups = prepareFacets(brief);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["codebase_dossier", "mandate", "general"]
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.key),
    ["codebase_dossier.stack", "codebase_dossier.maintainer_load"]
  );
});

test("prepareFacets exposes the trimmed value and leaves the raw one intact", () => {
  const brief = {
    facets: [facet({ key: "objective:gate_pass_rate", label: "gate pass rate", value: "gate pass rate — 95% within 60 days" })],
  } as RoleBrief;
  const item = prepareFacets(brief)[0].items[0];
  assert.equal(item.displayValue, "95% within 60 days");
  assert.equal(item.value, "gate pass rate — 95% within 60 days");
});

test("briefItemCount counts what the panel renders, not what the engine emitted", () => {
  const brief = {
    successCriteria: ["gate pass rate — 95% within 60 days"],
    requirements: [{ skill: "Java", kind: "must_have", weight: 0.9 }],
    facets: [
      facet({ key: "objective:gate_pass_rate", label: "gate pass rate", value: "gate pass rate — 95% within 60 days" }),
      facet({ key: "why_now", value: "Backfill." }),
    ],
  } as RoleBrief;
  // 1 criterion + 1 requirement + 1 surviving facet — the objective facet is the
  // criterion again, and the spine badge must not promise it twice.
  assert.equal(briefItemCount(brief), 3);
});

test("prepareFacets and briefItemCount tolerate an absent brief", () => {
  assert.deepEqual(prepareFacets(null), []);
  assert.equal(briefItemCount(null), 0);
});
