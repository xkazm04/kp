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
import { STUDIO_LOCALIZED_FILES, visibleLiterals } from "./devcaseStudioCopy.ts";

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

// ---- 4. the ONE-NAME rule (ship milestone one-thread, gap 7) ----------------
//
// The entity behind `dev_cases` had THREE user-facing names at once: the nav tab
// and the table header said **Assignment**, the lifecycle row and the empty ledger
// said **case**, and the API, DB and docs said **devcase**. The last of those is
// fine and stays — a stable identifier is not copy. The first two were the defect:
// the same object renamed itself as the reader moved one panel down the page.
//
// The decision, recorded in docs/features/README.md § "One vocabulary along the
// thread": **Assignment** is the only word the user ever sees for it. `case`,
// `dev case` and `devcase` are identifiers now, not vocabulary.
//
// Machine-checkable half, pinned here. English is the source of truth (the other
// three catalogs are translations OF it), so the word ban is asserted on `en` and
// the cross-locale half is asserted as agreement between the keys that name the
// entity BARE — which is exactly where the drift was visible: `nav.tabs.assignments`
// said "Assignments" while `devcase.emptyLedger.statCases` two clicks away said
// "Cases", in all four languages.

/** The namespaces that describe the assignment to a user. Deliberately a list, not
 *  "the whole catalog": `models.*` / `activity.*` / `analytics.*` legitimately say
 *  "use case" about an LLM operation, which is a different noun that happens to
 *  share a word. */
const ASSIGNMENT_NAMESPACES = ["devcase", "devApply", "about", "palettePreview", "setup"] as const;

/** Keys allowed to keep the word, each for a stated reason. Empty is the goal;
 *  an entry here is a debt, not an exemption granted in advance. */
const CASE_WORD_ALLOWLIST = new Set<string>([]);

const CASE_WORD = /\b(dev[\s-]?cases?|cases?)\b/i;

test("no English copy about the assignment still calls it a case", () => {
  const en = JSON.parse(read("messages", "en.json")) as Record<string, unknown>;
  const offenders: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      // ICU placeholders are IDENTIFIERS, not copy — `Interview kit: {case}` names
      // a variable holding the assignment's title and is not the word on screen.
      const copy = node.replace(/\{[^{}]*\}/g, " ");
      if (CASE_WORD.test(copy) && !CASE_WORD_ALLOWLIST.has(path)) offenders.push(`${path} :: ${node}`);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  for (const ns of ASSIGNMENT_NAMESPACES) walk(en[ns], ns);
  assert.deepEqual(
    offenders,
    [],
    "these strings still name the assignment a 'case'. The user-facing word is Assignment; `dev_cases`, " +
      "/api/devcase and the devcase.* message namespace stay as identifiers. Fix the copy in all four " +
      "catalogs — do NOT add the key to CASE_WORD_ALLOWLIST to make this pass"
  );
});

test("no allowlisted key has quietly stopped being an offender", () => {
  // The other half of the fail-loud contract: a stale exemption is as much a lie as
  // a missing one, and an allowlist nobody prunes is how a ban decays into a list.
  const en = JSON.parse(read("messages", "en.json")) as Record<string, unknown>;
  for (const key of CASE_WORD_ALLOWLIST) {
    const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
    assert.equal(typeof value, "string", `CASE_WORD_ALLOWLIST holds ${key}, which no longer exists — delete it`);
    assert.ok(
      CASE_WORD.test((value as string).replace(/\{[^{}]*\}/g, " ")),
      `CASE_WORD_ALLOWLIST holds ${key}, which no longer says "case" — delete the exemption`
    );
  }
});

test("the sub-tab headings module does not smuggle the old word past the catalogs", () => {
  // DevTabViews.ts holds the Assignments studio's sub-tab labels and headings as
  // plain English string literals — the ONE piece of user copy on this surface that
  // is not in messages/. That is why it kept saying "Cases" / "Active cases" /
  // "Click a case" while every catalog-backed label already said Assignment: no
  // locale gate reads it, so nothing could notice. Its lack of localization is a
  // separate open gap; the WORD is guarded here.
  const src = read("app", "features", "tools", "devcases", "DevTabViews.ts");
  // The COPY fields only. `id:` holds route/state keys ("cases" is a DevView id and
  // must not move), and a comment is allowed to name the word it retired — a guard
  // that fires on its own rationale teaches the next reader to delete the rationale.
  const copy = [...src.matchAll(/\b(?:label|title|blurb):\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)].map(
    (m) => m[1] ?? m[2]
  );
  assert.ok(copy.length >= 6, "found no copy fields in DevTabViews.ts — the shape changed and this guard is blind");
  const offenders = copy.filter((s) => CASE_WORD.test(s.replace(/\$\{[^}]*\}/g, " ")));
  assert.deepEqual(offenders, [], "DevTabViews.ts still calls the assignment a 'case' in user-visible copy");
});

test("the Assignments studio's own components do not smuggle the old word past the catalogs", () => {
  // Same blind spot as DevTabViews.ts above, one layer out. The catalog walk cannot
  // see a raw JSX literal, and eslint.config.mjs deliberately leaves
  // `app/features/tools/devcases/**` out of the `no-literal-string` ERROR list — so
  // "All cases", "Publish this case?" and "I understand this case is degraded" sat in
  // the detail header, in English, past all three guards. Those files now read from
  // `devcase.studio.*`; this walks them so a literal cannot bring the retired word
  // back. The extractor is shared with devcase-studio-i18n.test.ts, which is the
  // stricter half (it allows NO literal at all, retired word or not).
  const offenders: string[] = [];
  for (const file of STUDIO_LOCALIZED_FILES) {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), "utf8");
    for (const lit of visibleLiterals(src)) {
      if (CASE_WORD.test(lit.replace(/\$\{[^}]*\}/g, " "))) offenders.push(`${file} :: ${lit}`);
    }
  }
  assert.deepEqual(offenders, [], "the Assignments studio still calls the assignment a 'case' in user-visible copy");
});

/** The three places every locale names the entity with nothing else in the string.
 *  They must agree WITHIN a locale — that is what "one name" means once translated. */
const BARE_ASSIGNMENT_NAME_KEYS = [
  "nav.tabs.assignments",
  "palettePreview.assignments.cases",
  "devcase.emptyLedger.statCases",
] as const;

test("every locale uses ONE word for the assignment wherever it names it bare", () => {
  for (const locale of LOCALES) {
    const cat = JSON.parse(read("messages", `${locale}.json`)) as Record<string, unknown>;
    const values = BARE_ASSIGNMENT_NAME_KEYS.map((key) => {
      const v = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cat);
      assert.equal(typeof v, "string", `messages/${locale}.json is missing ${key}`);
      return v as string;
    });
    const distinct = [...new Set(values.map((v) => v.trim().toLowerCase()))];
    assert.equal(
      distinct.length,
      1,
      `messages/${locale}.json names the assignment ${distinct.length} different ways — ` +
        BARE_ASSIGNMENT_NAME_KEYS.map((k, i) => `${k}="${values[i]}"`).join(", ")
    );
  }
});

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
