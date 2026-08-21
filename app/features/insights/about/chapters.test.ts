// Keeps the About deck honest.
//
// This tab makes no writes and shows no live data — its only job is to be TRUE.
// An explainer that teaches a rule the product does not implement is worse than
// no explainer: the reader reasons confidently from it, and every downstream
// decision inherits the misunderstanding. So the deck's cited facts get the same
// treatment app/diagrams/pipelineSteps.test.ts gives the pipeline explorer's file
// list: every claim that is COUPLED to a constant elsewhere is asserted against
// that constant here, and a drift fails the suite instead of quietly misinforming.
//
// Scope note: this pins the couplings a test can check mechanically — the chapter
// frames, and chapter 4's tally arithmetic. Prose claims live in messages/*.json
// and are reviewed by reading; see each scene's header comment for the constants
// its copy quotes.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHAPTERS } from "./chapters.ts";
import { isWorkspaceTabId } from "../../shell/tabs.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// app/features/insights/about/ -> repo root.
const ROOT = path.resolve(HERE, "..", "..", "..", "..");

const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");

// ---- the chapter frames ----------------------------------------------------

test("every chapter hands off to a tab that still exists", () => {
  // Scene.tsx ends each chapter with `/?tab=<chapter.tab>`; that link is the
  // deck's whole "go watch it on your own data" promise. A retired or renamed id
  // resolves to the default tab, which reads as "the feature is gone".
  const dead = CHAPTERS.filter((c) => !isWorkspaceTabId(c.tab)).map((c) => `${c.id} -> ?tab=${c.tab}`);
  assert.deepEqual(dead, [], `About chapters point at ${dead.length} tab id(s) the shell no longer serves`);
});

test("every chapter has art, and every registered scene has a chapter", () => {
  // AboutTab's SCENES map is keyed by chapter id; a missing entry renders
  // `<undefined />` and takes the whole tab down.
  const src = read("AboutTab.tsx");
  const block = src.match(/const SCENES:[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, "could not find the SCENES map in AboutTab.tsx — update this test with it");
  const mapped = [...block[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:/gm)].map((m) => m[1] ?? m[2]);

  assert.deepEqual(
    [...mapped].sort(),
    CHAPTERS.map((c) => c.id).sort(),
    "AboutTab.SCENES and CHAPTERS disagree about which chapters exist"
  );
});

test("chapter ids, catalog keys and numbers are each unique and in order", () => {
  // The id is a URL contract (`?tab=about#human-gates`) and the rail's target; a
  // duplicate silently steals another chapter's deep link.
  assert.equal(new Set(CHAPTERS.map((c) => c.id)).size, CHAPTERS.length, "duplicate chapter id");
  assert.equal(new Set(CHAPTERS.map((c) => c.key)).size, CHAPTERS.length, "duplicate catalog key");
  assert.deepEqual(
    CHAPTERS.map((c) => c.n),
    CHAPTERS.map((_, i) => i + 1),
    "chapter numbers must be 1..n in render order — the rail prints them as the reading position"
  );
});

// ---- chapter 4: the tally board --------------------------------------------
//
// ArchetypeRouter draws a real `registry.detect()` run: rules from
// pipeline/jobfit/archetypes.json vote with their real weights, the highest
// total wins, and the status line prints `winner / total` — detect's own
// `round(scores[best] / total, 2)`. The scene is only worth showing while those
// weights are the file's weights, so parse them back out and compare.

type DetectionRule = { id: string; scores?: Record<string, number> };
type Registry = {
  archetypes: { id: string }[];
  detection: {
    signals: DetectionRule[];
    selfDeclaredConfidence: number;
    defaultArchetype: string;
    defaultConfidence: number;
    lowConfidenceThreshold: number;
  };
};

const registry = (): Registry =>
  JSON.parse(readFileSync(path.resolve(ROOT, "pipeline", "jobfit", "archetypes.json"), "utf8")) as Registry;

/** The scene names rules by their CATALOG key (camelCase, so `signals.yreLow`
 *  reads as a message key); archetypes.json names them in snake_case. */
const ruleId = (sceneId: string) => sceneId.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const SCENE = "scenes/archetypes/ArchetypeRouter.tsx";

/** TARGETS, in the order the scene stacks them — `votes` index into this. */
function sceneTargets(): string[] {
  const src = read(SCENE);
  const block = src.match(/const TARGETS = \[([\s\S]*?)\n\] as const;/);
  assert.ok(block, `could not find TARGETS in ${SCENE} — update this test with its new shape`);
  return [...block[1].matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** SIGNALS as `{ sceneId -> { archetypeId: weight } }` — the shape
 *  archetypes.json stores a rule's `scores` in, so the two compare directly. */
function sceneSignals(targets: string[]): Record<string, Record<string, number>> {
  const src = read(SCENE);
  const block = src.match(/const SIGNALS: readonly[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, `could not find SIGNALS in ${SCENE} — update this test with its new shape`);
  const out: Record<string, Record<string, number>> = {};
  for (const row of block[1].matchAll(/\{\s*id:\s*"([^"]+)",\s*votes:\s*\[([^\]]*\])\s*\]/g)) {
    const scores: Record<string, number> = {};
    for (const vote of row[2].matchAll(/\[\s*(\d+)\s*,\s*([\d.]+)\s*\]/g)) {
      const target = targets[Number(vote[1])];
      assert.ok(target, `${SCENE}: signal "${row[1]}" votes for TARGETS[${vote[1]}], which does not exist`);
      scores[target] = Number(vote[2]);
    }
    out[row[1]] = scores;
  }
  assert.ok(Object.keys(out).length > 0, `parsed no SIGNALS out of ${SCENE}`);
  return out;
}

test("the archetype scene's tally board is drawn from the real registry", () => {
  const reg = registry();
  const known = new Set(reg.archetypes.map((a) => a.id));
  const targets = sceneTargets();

  const unknown = targets.filter((id) => !known.has(id));
  assert.deepEqual(unknown, [], `${SCENE} tallies archetype(s) the registry does not ship`);
  assert.equal(
    targets.length,
    reg.archetypes.length,
    `${SCENE} shows ${targets.length} of ${reg.archetypes.length} archetypes — the board is a full tally, so a new archetype needs a row (or the scene needs to say it is showing a subset)`
  );

  const rules = new Map(reg.detection.signals.map((s) => [s.id, s]));
  for (const [sceneId, scores] of Object.entries(sceneSignals(targets))) {
    const rule = rules.get(ruleId(sceneId));
    assert.ok(rule, `${SCENE}: signal "${sceneId}" (${ruleId(sceneId)}) is not a rule in archetypes.json`);
    assert.deepEqual(
      scores,
      rule.scores ?? {},
      `${SCENE}: signal "${sceneId}" draws votes that are not the rule's real \`scores\` map. Every vote it casts has to be on the board, or the totals stop adding up to the division the status line prints.`
    );
  }
});

test("the archetype scene's quoted detection constants still hold", () => {
  // These four numbers are quoted verbatim in about.archetypes.declaration /
  // .fallback / .status.s9 / .status.s10 (all four locales). They are the
  // chapter's argument — a self-declaration is trusted, and an unguided default
  // lands BELOW the review threshold so "we had no idea" can never read as a
  // quiet result. If one moves upstream, that copy has to move with it.
  const { detection } = registry();
  assert.equal(detection.selfDeclaredConfidence, 0.9, "about.archetypes.declaration + status.s9 quote 0.9");
  assert.equal(detection.defaultArchetype, "bau", "about.archetypes.fallback names <k>bau</k>");
  assert.equal(detection.defaultConfidence, 0.4, "about.archetypes.fallback + status.s10 quote 0.4");
  assert.equal(detection.lowConfidenceThreshold, 0.55, "about.archetypes.fallback + status.s10 quote 0.55");
  assert.ok(
    detection.defaultConfidence < detection.lowConfidenceThreshold,
    "the chapter's whole point: the unguided fallback must sit BELOW the review threshold"
  );
});
