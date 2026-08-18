// THE RENDER MAP — what the Analytics tab actually reaches.
//
// UAT 2026-08-17-analytics-sections, findings KAT-ANA-3 and TOM-ANA-2 (convergent,
// both executed against the import graph). Backlog item 11.
//
// Why this file exists: the section consolidation kept the machinery and dropped the
// wiring. Nine modules stopped being rendered, seven payload fields kept being
// computed on every request with no reader, and NOT ONE of them produced a test
// failure, a type error or a lint warning. `analyticsSections.test.ts` pins the
// section VOCABULARY — which `?sec=` ids resolve — and nothing pinned the RENDER MAP.
// A panel that compiles, translates cleanly and is imported by nobody is invisible to
// every gate this repo runs.
//
// The measure, and why it is not a file count: `sectionChunks.tsx` declares N dynamic
// chunks and the sections import M of them. Declared-vs-imported is the ratio that
// answers "is this rendered anywhere"; a file count answers a different question, which
// is why three independent reviewers reported this same defect as "33 panels", "35" and
// "40 clean + 9 orphaned" — each counted a different unit.
//
// Two properties make it hard to cheat:
//   • the walk is TRANSITIVE from the real entry point (`AnalyticsTab`, which is what
//     app/features/shell/tabChunks.ts loads for `?tab=analytics`), so a module imported
//     only by another orphan is still unreachable — its importer launders nothing;
//   • the barrel is walked BY EXPORT NAME, not as a file. `sectionChunks` dynamically
//     imports every panel it declares, so a file-level walk would call an unimported
//     chunk "reachable" through the barrel and miss the exact defect that hid the only
//     write path to `channel_spend` for six weeks.
//
// Both properties are asserted against a synthetic graph at the bottom, so the walker
// itself is covered rather than trusted.
//
// The allowlists below are STAGED work, not exemptions, and each one self-clears: the
// test fails when the staged edit lands (telling you to delete the entry) and fails if
// the module it names disappears. A guard whose allowlist can rot into a hand-copied
// snapshot is the anti-pattern this drain also filed (§2.21) — this one cannot.
//
// Runner: `npm run test:unit` (node --test, process-isolated, type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = fileURLToPath(new URL(".", import.meta.url));
/** What the shell loads for `?tab=analytics` — the only door into this tree. */
const ENTRY = "AnalyticsTab.tsx";
/** The per-panel dynamic barrel. Walked by export name, never as a file. */
const BARREL = "sections/sectionChunks.tsx";

// ---------------------------------------------------------------------------
// Staged work — every entry names the exact edit that clears it.
// ---------------------------------------------------------------------------

/** A RESTORE whose last wire is one line in a section file item 11 does not own. */
type StagedWire = {
  module: string;
  section: string;
  symbol: string;
  /** Payload fields that reach a screen through this wire and only through it. */
  fields: string[];
  reason: string;
};
const STAGED_WIRES: StagedWire[] = [
  // All cleared 2026-08-18: every staged edit landed (panels wired into
  // PerformanceBriefing, the two fields into EconomicsBoard, the three superseded
  // panels deleted). An entry here is a promise with an expiry date, not a waiver.
];

/** A DELETE whose last step touches a file item 11 does not own. */
const STAGED_DELETES: { module: string; blockedBy: string; reason: string }[] = [
  // All cleared 2026-08-18: every staged edit landed (panels wired into
  // PerformanceBriefing, the two fields into EconomicsBoard, the three superseded
  // panels deleted). An entry here is a promise with an expiry date, not a waiver.
];

/** A payload field whose renderer is a one-line edit in a file item 11 does not own. */
const STAGED_FIELDS: { field: string; section: string; reason: string }[] = [
  // All cleared 2026-08-18: every staged edit landed (panels wired into
  // PerformanceBriefing, the two fields into EconomicsBoard, the three superseded
  // panels deleted). An entry here is a promise with an expiry date, not a waiver.
];

// ---------------------------------------------------------------------------
// The walker.
// ---------------------------------------------------------------------------

type Graph = {
  reachable: Set<string>;
  /** sectionChunks export name → the module it dynamically imports. */
  chunks: Map<string, string>;
  /** Chunk names imported by a reachable module. */
  importedChunkNames: Set<string>;
};

/** Comments describe the removed edges on purpose; never let one create a fake one. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ALIAS = "@/app/features/insights/analytics/";

function walkRenderMap(sources: Map<string, string>, entries: string[], barrel: string): Graph {
  const code = new Map([...sources].map(([f, src]) => [f, stripComments(src)]));

  const resolve = (from: string, spec: string): string | null => {
    let target: string;
    if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    else if (spec.startsWith(ALIAS)) target = spec.slice(ALIAS.length);
    else return null; // outside the tab's tree — a boundary, not an edge
    for (const candidate of [`${target}.tsx`, `${target}.ts`, `${target}/index.tsx`, `${target}/index.ts`, target]) {
      if (code.has(candidate)) return candidate;
    }
    return null;
  };

  // `export const Name = dynamic(() => import("../Panel")…)` — the barrel's edges are
  // keyed by export name, which is what makes an unimported chunk stay unreachable.
  const chunks = new Map<string, string>();
  for (const m of (code.get(barrel) ?? "").matchAll(/export\s+const\s+(\w+)\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\("([^"]+)"\)/g)) {
    const target = resolve(barrel, m[2]);
    if (target) chunks.set(m[1], target);
  }

  const barrelNamesIn = (file: string): string[] => {
    const names: string[] = [];
    for (const m of (code.get(file) ?? "").matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
      if (resolve(file, m[2]) !== barrel) continue;
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    return names;
  };

  const reachable = new Set(entries.filter((e) => code.has(e)));
  const importedChunkNames = new Set<string>();
  // Fixpoint rather than one pass: which chunk names count as imported can grow as the
  // frontier grows, and each new name can open a subtree.
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of [...reachable]) {
      if (file === barrel) {
        for (const name of importedChunkNames) {
          const target = chunks.get(name);
          if (target && !reachable.has(target)) {
            reachable.add(target);
            changed = true;
          }
        }
        continue;
      }
      for (const name of barrelNamesIn(file)) {
        if (!importedChunkNames.has(name)) {
          importedChunkNames.add(name);
          changed = true;
        }
      }
      // `from "x"` covers static imports and re-exports; `import("x")` the dynamic ones.
      for (const m of (code.get(file) ?? "").matchAll(/(?:from\s*|import\s*\(\s*)"([^"]+)"/g)) {
        const target = resolve(file, m[1]);
        if (target && !reachable.has(target)) {
          reachable.add(target);
          changed = true;
        }
      }
    }
  }
  return { reachable, chunks, importedChunkNames };
}

// ---------------------------------------------------------------------------
// The real graph.
// ---------------------------------------------------------------------------

const listModules = (dir: string, prefix = ""): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listModules(full, `${prefix}${name}/`);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [`${prefix}${name}`];
  });

const MODULES = listModules(DIR);
const SOURCES = new Map(MODULES.map((f) => [f, readFileSync(path.join(DIR, f), "utf8")]));

/** Reachable today, from the door the shell actually opens. */
const live = walkRenderMap(SOURCES, [ENTRY], BARREL);
/** …and reachable once the staged wires land — the state this change is aiming at. */
const staged = walkRenderMap(SOURCES, [ENTRY, ...STAGED_WIRES.map((w) => w.module)], BARREL);

const stagedModules = new Set([...STAGED_WIRES.map((w) => w.module), ...STAGED_DELETES.map((d) => d.module)]);

test("every module under the Analytics tab is reachable from AnalyticsTab", () => {
  assert.ok(SOURCES.has(ENTRY), "the entry point moved; this whole file is measuring nothing until it is renamed here");
  const orphans = MODULES.filter((f) => !staged.reachable.has(f) && !stagedModules.has(f));
  assert.deepEqual(
    orphans,
    [],
    `unreachable from ${ENTRY}: ${orphans.join(", ")}. Render it from a section, delete it, or add it to STAGED_WIRES/STAGED_DELETES with the edit that clears it — a module nobody imports ships in no bundle and is read by no user.`
  );
});

test("sectionChunks declares no chunk the sections do not import", () => {
  const declared = [...live.chunks.keys()];
  assert.ok(declared.length > 0, "the barrel's `export const X = dynamic(() => import(...))` shape changed; the parse found nothing");
  const unimported = declared.filter((name) => !live.importedChunkNames.has(name));
  assert.deepEqual(
    unimported,
    [],
    `declared in ${BARREL} and imported by no section: ${unimported.join(", ")}. This is the ratio that hid the channel-spend write path: the chunk existed, compiled and translated, and no surface asked for it.`
  );
  // The other direction: a name imported from the barrel that the barrel never
  // declares. tsc catches it, but the assertion keeps the two halves of the ratio
  // meaningful when this test is read on its own.
  const undeclared = [...live.importedChunkNames].filter((name) => !live.chunks.has(name));
  assert.deepEqual(undeclared, [], `imported from the barrel but not declared there: ${undeclared.join(", ")}`);
});

test("every payload field the server computes reaches a renderer", () => {
  // The half of the defect a graph walk cannot see: `stageDwell` was folded on every
  // request for weeks with no reader. A field arrives as `data.<field>` in a section
  // or a panel that takes the payload — panels receiving it as a prop are covered
  // through their caller, which is the file the section owns.
  const types = SOURCES.get("AnalyticsTypes.ts");
  assert.ok(types, "AnalyticsTypes.ts moved; the payload shape can no longer be read");
  const body = stripComments(types!.slice(types!.indexOf("export type Analytics = {")));
  const fields = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(fields.length > 10, `the Analytics type parse found only ${fields.length} fields; the shape changed`);

  const rendered = new Set<string>();
  for (const file of live.reachable) {
    const code = stripComments(SOURCES.get(file) ?? "");
    for (const field of fields) if (new RegExp(`\\bdata\\??\\.${field}\\b`).test(code)) rendered.add(field);
  }
  const stagedFieldNames = new Set([...STAGED_WIRES.flatMap((w) => w.fields), ...STAGED_FIELDS.map((f) => f.field)]);
  const unrendered = fields.filter((f) => !rendered.has(f) && !stagedFieldNames.has(f));
  assert.deepEqual(
    unrendered,
    [],
    `computed on every request and rendered nowhere: ${unrendered.join(", ")}. Give the field a renderer or stop computing it in app/_lib/db/analytics.ts — a payload field with no reader is a cost with no product.`
  );
});

test("the staged allowlists self-clear", () => {
  for (const wire of STAGED_WIRES) {
    assert.ok(SOURCES.has(wire.module), `STAGED_WIRES names ${wire.module}, which does not exist — the restore was abandoned, so delete the entry`);
    assert.ok(SOURCES.has(wire.section), `STAGED_WIRES points at ${wire.section}, which does not exist`);
    assert.ok(
      !live.reachable.has(wire.module),
      `${wire.module} is reachable now: the wire landed. Delete its STAGED_WIRES entry — an allowlist that outlives its reason is how a guard becomes a snapshot.`
    );
    assert.doesNotMatch(
      stripComments(SOURCES.get(wire.section) ?? ""),
      new RegExp(`\\b${wire.symbol}\\b`),
      `${wire.section} already names ${wire.symbol}; delete the STAGED_WIRES entry`
    );
    assert.ok(wire.reason.length > 40, "a staged entry without a real reason is an exemption wearing a costume");
  }
  for (const del of STAGED_DELETES) {
    assert.ok(
      existsSync(path.join(DIR, del.module)),
      `STAGED_DELETES names ${del.module}, which is already gone — the delete landed, so delete the entry too`
    );
    assert.ok(!live.reachable.has(del.module), `${del.module} is rendered again; it is no longer a pending delete`);
    assert.ok(del.reason.length > 40 && del.blockedBy.length > 10, "name the blocker and the reasoning, not just the file");
  }
  for (const f of STAGED_FIELDS) {
    assert.ok(SOURCES.has(f.section), `STAGED_FIELDS points at ${f.section}, which does not exist`);
    const alreadyRendered = [...live.reachable].some((file) =>
      new RegExp(`\\bdata\\??\\.${f.field}\\b`).test(stripComments(SOURCES.get(file) ?? ""))
    );
    assert.ok(!alreadyRendered, `data.${f.field} now has a renderer; delete its STAGED_FIELDS entry`);
  }
});

// ---------------------------------------------------------------------------
// The walker under test — the two properties the enumeration rests on.
// ---------------------------------------------------------------------------

test("the walk is transitive and the barrel is name-aware", () => {
  const synthetic = new Map<string, string>([
    ["entry.tsx", `import { A } from "./a";\nimport { Live } from "./bar/chunks";\n`],
    ["a.tsx", `export const A = 1;\n`],
    [
      "bar/chunks.tsx",
      `export const Live = dynamic(() => import("../live").then((m) => ({ default: m.Live })));\n` +
        `export const Dead = dynamic(() => import("../dead").then((m) => ({ default: m.Dead })));\n`,
    ],
    ["live.tsx", `import { Deep } from "@/app/features/insights/analytics/deep";\n`],
    ["deep.tsx", `export const Deep = 1;\n`],
    // Imported ONLY by the barrel entry nobody asks for.
    ["dead.tsx", `import { OnlyDead } from "./onlyDead";\n`],
    ["onlyDead.tsx", `export const OnlyDead = 1;\n`],
    // An orphan that imports a live module: importing reachable code must not make
    // the importer reachable. This is the cheat the file-level walk falls for.
    ["orphan.tsx", `import { A } from "./a";\n// import { Live } from "./bar/chunks";\n`],
  ]);
  const g = walkRenderMap(synthetic, ["entry.tsx"], "bar/chunks.tsx");

  assert.deepEqual([...g.reachable].sort(), ["a.tsx", "bar/chunks.tsx", "deep.tsx", "entry.tsx", "live.tsx"]);
  assert.equal(g.reachable.has("deep.tsx"), true, "transitive: reached only through live.tsx, and through the alias form");
  assert.equal(g.reachable.has("dead.tsx"), false, "the barrel declares it, no one imports the name: unreachable");
  assert.equal(g.reachable.has("onlyDead.tsx"), false, "imported only by an orphan, so still unreachable");
  assert.equal(g.reachable.has("orphan.tsx"), false, "importing live code launders nothing");
  assert.deepEqual([...g.chunks.keys()], ["Live", "Dead"]);
  assert.deepEqual([...g.importedChunkNames], ["Live"], "the commented-out import in orphan.tsx is not an edge");
});
