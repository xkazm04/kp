// The routing line the result panel shows: localized codes first, the router's
// English sentence only as the per-reason fallback. Two things are pinned here —
// the fallback chain itself, and the fact that EVERY reason kind archetypes.json
// can emit has an entry in all four catalogs (a kind with no entry would silently
// print English to a cs/de/fr reader, which is the defect this closes).
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  routingReasonText,
  routingReasonsLine,
  SELF_DECLARED_REASON_KIND,
  type RoutingReasonCode,
} from "./profileRoutingReasons.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), "utf8"));

// A translator double: resolves a kind from a tiny catalog, interpolating {name}
// placeholders the way ICU would; unknown kinds return null (the has-check).
const catalog: Record<string, string> = {
  signal_enrolled: "právě studuje",
  signal_yre_high: "{years_relevant_experience} let relevantní praxe",
  self_declared: "uvedeno kandidátem: {archetype}",
};
const translate = (kind: string, params: Record<string, string | number>) => {
  const entry = catalog[kind];
  if (!entry) return null;
  return entry.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? `{${k}}`));
};

test("a known kind renders from the catalog, never the router's English", () => {
  const code: RoutingReasonCode = { kind: "signal_enrolled" };
  assert.equal(routingReasonText(code, "currently enrolled", translate), "právě studuje");
});

test("params come off the code and interpolate", () => {
  const code: RoutingReasonCode = { kind: "signal_yre_high", params: { years_relevant_experience: 5 } };
  assert.equal(routingReasonText(code, "5 years of relevant experience", translate), "5 let relevantní praxe");
});

test("a null param is dropped rather than interpolated as the word null", () => {
  const code: RoutingReasonCode = { kind: "signal_yre_high", params: { years_relevant_experience: null } };
  // The placeholder survives untouched (the double's own marker) — what must NOT
  // happen is "null let relevantní praxe" reaching a recruiter.
  assert.equal(routingReasonText(code, "legacy", translate).includes("null"), false);
});

test("an untranslated kind falls back to the router's sentence at the same index", () => {
  const line = routingReasonsLine(
    [{ kind: "signal_enrolled" }, { kind: "signal_education_dominant" }],
    ["currently enrolled", "education is the dominant CV block"],
    translate
  );
  assert.equal(line, "právě studuje; education is the dominant CV block");
});

test("a result built before reasonCodes existed still renders its legacy strings", () => {
  assert.equal(
    routingReasonsLine(undefined, ["currently enrolled", "education is the dominant CV block"], translate),
    "currently enrolled; education is the dominant CV block"
  );
  assert.equal(routingReasonsLine([], [], translate), "");
  assert.equal(routingReasonsLine(undefined, undefined, translate), "");
});

test("a code with no legacy twin and no catalog entry contributes no empty segment", () => {
  assert.equal(routingReasonsLine([{ kind: "unknown_kind" }, { kind: "signal_enrolled" }], [], translate), "právě studuje");
});

// --- The catalog contract ---------------------------------------------------

test("every reason kind archetypes.json can emit has an entry in all four catalogs", () => {
  const registry = read("pipeline/jobfit/archetypes.json") as {
    detection: {
      defaultReasonKind: string;
      selfDeclaredReasonKind: string;
      signals: { reasonKind?: string }[];
      contradictions: Record<string, { reasonKind: string }[]>;
    };
  };
  const d = registry.detection;
  const kinds = [
    d.defaultReasonKind,
    d.selfDeclaredReasonKind,
    ...d.signals.map((s) => s.reasonKind).filter((k): k is string => Boolean(k)),
    ...Object.values(d.contradictions).flatMap((rules) => rules.map((r) => r.reasonKind)),
  ];
  assert.ok(kinds.length >= 10, "the registry should emit a kind per reason-bearing rule");
  // The panel special-cases this one kind to localize its archetype id; a rename in
  // the data would otherwise leave the wire id rendering raw in the sentence.
  assert.equal(d.selfDeclaredReasonKind, SELF_DECLARED_REASON_KIND);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const messages = read(`messages/${locale}.json`) as {
      profile: { result: { reasons?: Record<string, string> } };
    };
    const reasons = messages.profile.result.reasons ?? {};
    for (const kind of kinds) {
      assert.ok(reasons[kind], `messages/${locale}.json is missing profile.result.reasons.${kind}`);
    }
  }
});
