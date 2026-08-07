// Every devcase enum that becomes a WORD on screen, pinned twice.
//
// WHY THIS FILE EXISTS. A localized enum has two independent ways to rot and the
// project's three green gates catch neither:
//
//   1. The TS tuple drifts from its PRODUCER. `design.py` gains a fifth probe kind,
//      nothing in TypeScript references it, and the new kind renders through a
//      de-underscored raw-value fallback forever.
//   2. The i18n catalog drifts from the TS tuple. `npm run i18n:check` compares the
//      four locales to EACH OTHER and never to the domain vocabulary, so deleting a
//      key from all four leaves it green. `tsc` is silent too — every one of these
//      lookups is a template-string key or a `.has()`-guarded string index.
//
// That is not hypothetical. In round 22 a localization pass shipped a FOUR-key
// outbox-kind catalog against a THIRTEEN-kind vocabulary; 23 of 40 rows rendered
// English inside a German UI and every gate stayed green (see
// outbox-kind-catalog.test.ts). The rule that came out of it: never enumerate an
// enum by eye — derive it from the producer and assert set equality.
//
// This file applies that rule to the rest of the devcase vocabulary. The Python
// producers are read as TEXT rather than imported, because the point is to fail when
// the PRODUCING SOURCE changes, and because importing the orchestrator would drag the
// server DB into a unit test.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CANARY_KINDS,
  LEDGER_CONTROL_IDS,
  LIFECYCLE_STAGES,
  PROBE_KINDS,
  PROBE_STATUSES,
  RUBRIC_DIMENSION_NAMES,
} from "./DevTypes.ts";

// app/features/tools/devcases/ -> repo root is four levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf8");

/** Pull the string members out of a `NAME = (...)` / `NAME = [...]` literal. */
function members(src: string, decl: RegExp): string[] {
  const m = src.match(decl);
  assert.ok(m, `could not locate ${decl} — the producer moved or was renamed, so this guard is blind`);
  return [...m![1].matchAll(/["']([A-Za-z0-9_]+)["']/g)].map((x) => x[1]);
}

function catalog(locale: string, ...namespace: string[]): Record<string, unknown> {
  let node = JSON.parse(read("messages", `${locale}.json`)) as Record<string, unknown>;
  for (const seg of namespace) node = (node?.[seg] ?? {}) as Record<string, unknown>;
  return node;
}

/** Set equality in BOTH directions. Call it as (whatWeDeclare, whatTheTruthIs), so
 *  "MISSING x" always reads "the thing under test does not know about x" and "EXTRA x"
 *  always reads "the thing under test invented x". A missing value renders as a raw
 *  code at runtime; an extra one means the vocabulary was guessed, not read off the
 *  producer (round 22 shipped a catalog containing "invite", which nothing emits). */
function assertSameSet(actual: readonly string[], expected: readonly string[], what: string) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  const missing = e.filter((k) => !a.includes(k));
  const extra = a.filter((k) => !e.includes(k));
  assert.deepEqual(missing, [], `${what} is MISSING ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `${what} has EXTRA ${extra.join(", ")}`);
}

// ---- 1. the TS tuples match their producers --------------------------------

test("LIFECYCLE_STAGES matches devcase-orchestrator.ts STAGES", () => {
  const src = read("app", "_lib", "devcase-orchestrator.ts");
  assertSameSet(
    LIFECYCLE_STAGES,
    members(src, /const STAGES = \[([^\]]*)\]/),
    "DevTypes.LIFECYCLE_STAGES vs the orchestrator's STAGES — the orchestrator is the only thing that " +
      "writes a stage, so a stage it can set and this tuple does not know renders as a raw id in the " +
      "Cases table and the lifecycle row (`closed` did exactly that). Update the tuple AND all four " +
      "devcase.stage catalogs"
  );
});

test("PROBE_KINDS matches design.py PROBE_KINDS", () => {
  const src = read("pipeline", "jobfit", "devcase", "design.py");
  assertSameSet(
    PROBE_KINDS,
    members(src, /^PROBE_KINDS = \(([^)]*)\)/m),
    "DevTypes.PROBE_KINDS vs design.py — update the tuple, the devcase.probeKind catalogs AND " +
      "PROBE_KIND_TINT in DevEvalPanel.tsx"
  );
});

test("CANARY_KINDS matches seed_materializer.py CANARY_KINDS", () => {
  const src = read("pipeline", "jobfit", "devcase", "seed_materializer.py");
  assertSameSet(
    CANARY_KINDS,
    members(src, /^CANARY_KINDS = \(([^)]*)\)/m),
    "DevTypes.CANARY_KINDS vs seed_materializer.py — a kind the seed can plant but the catalog does not " +
      "know renders as a raw code beside the canary verdict"
  );
});

test("RUBRIC_DIMENSION_NAMES matches models.py RUBRIC_DIMENSIONS", () => {
  const src = read("pipeline", "jobfit", "devcase", "models.py");
  const block = src.match(/RUBRIC_DIMENSIONS: list\[dict\] = \[([\s\S]*?)\n\]/);
  assert.ok(block, "could not locate RUBRIC_DIMENSIONS in models.py");
  assertSameSet(
    RUBRIC_DIMENSION_NAMES,
    [...block![1].matchAll(/"name":\s*"([a-z_]+)"/g)].map((m) => m[1]),
    "DevTypes.RUBRIC_DIMENSION_NAMES vs models.py RUBRIC_DIMENSIONS. This set is read only by the " +
      "pre-`dimensions` fallback in DevEvalPanel, which is exactly why it needs a guard — nothing else " +
      "would ever notice it rotting"
  );
});

// ---- 2. every locale catalog matches its tuple -----------------------------

const VOCABULARIES: Array<{ ns: string[]; values: readonly string[]; note: string }> = [
  { ns: ["devcase", "stage"], values: LIFECYCLE_STAGES, note: "lifecycle stage chips (Cases table + lifecycle row)" },
  { ns: ["devcase", "probeKind"], values: PROBE_KINDS, note: "probe-kind chips in the evaluation panel" },
  { ns: ["devcase", "canaryKind"], values: CANARY_KINDS, note: "what each planted canary IS, beside its verdict" },
  { ns: ["devcase", "probeStatus"], values: PROBE_STATUSES, note: "probe-outcome states" },
  { ns: ["devcase", "dimension"], values: RUBRIC_DIMENSION_NAMES, note: "capability labels for pre-`dimensions` bundles" },
];

for (const { ns, values, note } of VOCABULARIES) {
  test(`every locale's ${ns.join(".")} catalog covers exactly its vocabulary`, () => {
    for (const locale of LOCALES) {
      assertSameSet(
        Object.keys(catalog(locale, ...ns)),
        values,
        `messages/${locale}.json ${ns.join(".")} (${note})`
      );
    }
  });
}

test("no locale leaves a vocabulary label empty", () => {
  for (const { ns } of VOCABULARIES) {
    for (const locale of LOCALES) {
      for (const [key, label] of Object.entries(catalog(locale, ...ns))) {
        assert.ok(
          typeof label === "string" && label.trim().length > 0,
          `messages/${locale}.json ${ns.join(".")}.${key} is empty`
        );
      }
    }
  }
});

// ---- 3. the marketed control list ------------------------------------------
//
// The empty-state control list is the product's headline claim and it is EDITORIAL,
// not producer-owned — so what is guarded here is that every locale markets the same
// six controls with both halves present. The separate contract that these six are the
// six the engine actually runs is stated in DevCasesEmptyLedger.tsx and in
// docs/features/dev-case/README.md; a machine cannot check that one, a reader can.

test("every locale markets exactly the six controls, name and claim both present", () => {
  assert.equal(LEDGER_CONTROL_IDS.length, 6, "the module ships six anti-delegation controls");
  for (const locale of LOCALES) {
    const controls = catalog(locale, "devcase", "emptyLedger", "control");
    assertSameSet(Object.keys(controls), LEDGER_CONTROL_IDS, `messages/${locale}.json devcase.emptyLedger.control`);
    for (const id of LEDGER_CONTROL_IDS) {
      const entry = controls[id] as { name?: string; proves?: string };
      assert.ok(entry?.name?.trim(), `messages/${locale}.json devcase.emptyLedger.control.${id}.name is missing`);
      assert.ok(entry?.proves?.trim(), `messages/${locale}.json devcase.emptyLedger.control.${id}.proves is missing`);
    }
  }
});
