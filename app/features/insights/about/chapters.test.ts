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

// ---- the constants chapters 2, 3 and 5 quote --------------------------------
//
// Chapter 4 got this treatment from the start; the other three quoted engine
// numbers to the reader with nothing watching them, which is the failure mode
// this file exists to prevent. Each block below reads the SOURCE the copy names
// and fails if the number moved — and, where the number is printed in prose,
// checks the English catalog string still contains it, because a guard that
// pins the code but not the sentence lets the deck go on saying 0.5 after the
// engine moved to 0.6.
//
// `pySource` reads a Python file as text rather than importing it: a `python -c`
// per assertion would make this suite depend on an interpreter, and the deck's
// couplings are all module-level literals a regex reads exactly.

const pySource = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");

/** A module-level `NAME = <number>` assignment. */
function pyConst(rel: string, name: string): number {
  const src = pySource(rel);
  const hit = src.match(new RegExp(`^${name}\\s*=\\s*(-?[\\d.]+)\\s*(?:#|$)`, "m"));
  assert.ok(hit, `${rel} no longer declares a module-level \`${name}\` — the About deck quotes it`);
  return Number(hit[1]);
}

const enAbout = (): Record<string, unknown> =>
  (JSON.parse(readFileSync(path.resolve(ROOT, "messages", "en.json"), "utf8")) as { about: Record<string, unknown> }).about;

/** `scoring.status.s2` → the string, so a test can assert what the copy quotes. */
function copy(dotted: string): string {
  let node: unknown = enAbout();
  for (const seg of dotted.split(".")) {
    assert.ok(node && typeof node === "object", `messages/en.json: about.${dotted} — "${seg}" has no parent object`);
    node = (node as Record<string, unknown>)[seg];
  }
  assert.equal(typeof node, "string", `messages/en.json: about.${dotted} is missing`);
  return node as string;
}

test("chapter 2's two thresholds are still the engine's", () => {
  // The scene paints ONE line across seven bars at `TRACK_X + TRACK_W * 0.5`,
  // and the whole chapter is the claim that that line is where the product
  // actually splits matched from unproven.
  const matchThreshold = pyConst("pipeline/jobfit/matching.py", "_MATCH_THRESHOLD");
  // NOT matching.py: the sibling rule lives with the taxonomy that decides what
  // "adjacent" means. ScoringBuckets.tsx cited the wrong module, so a reader who
  // went to grep for it found nothing — which is the opposite of the point.
  const siblingMatch = pyConst("pipeline/jobfit/taxonomy.py", "_SIBLING_MATCH");

  assert.equal(matchThreshold, 0.5, "about.scoring.status.s2 and the painted line both quote 0.5");
  assert.equal(siblingMatch, 0.4, "about.scoring.status.s10 and SIBLING_MATCH_LABEL both quote 0.4");
  assert.ok(
    siblingMatch < matchThreshold,
    "the chapter's argument: an adjacent skill must score BELOW the line, so it can never be counted as the real one"
  );

  assert.match(copy("scoring.status.s2"), new RegExp(String(matchThreshold)));
  assert.match(copy("scoring.status.s10"), new RegExp(String(siblingMatch)));
  assert.match(read("scenes/scoring/ScoringBuckets.tsx"), new RegExp(`_SIBLING_MATCH = ${siblingMatch}`));

  // The painted line is derived, not typed: `THRESHOLD_X = TRACK_X + TRACK_W * <f>`.
  const fraction = read("scenes/scoring/ScoringBuckets.tsx").match(/const THRESHOLD_X = TRACK_X \+ TRACK_W \* ([\d.]+);/);
  assert.ok(fraction, "ScoringBuckets.tsx no longer derives THRESHOLD_X from TRACK_X/TRACK_W");
  assert.equal(
    Number(fraction[1]),
    matchThreshold,
    "the painted line's position and _MATCH_THRESHOLD are the same number, or the scene is drawing a lie"
  );
});

test("chapter 3 names three real layers, and marks its cohort figures as an example", () => {
  const matching = pySource("pipeline/jobfit/matching.py");
  // A and B are functions in matching.py; C is its own module (the scene prints
  // it with parens as a stage name, which is why this checks for the module).
  assert.match(matching, /^def ko_filter\(/m, "about.screening layer A prints `ko_filter()`");
  assert.match(matching, /^def score_job\(/m, "about.screening layer B prints `score_job()`");
  assert.ok(
    pySource("pipeline/jobfit/match_reasoning.py").length > 0,
    "about.screening layer C prints `match_reasoning()`"
  );

  // The gate reasons are a real closed vocabulary. The scene shows four of the
  // five (early_career has no row) — a SUBSET is fine, and the copy says "hard
  // gates" rather than "all of them"; an INVENTED key would not be.
  const literal = matching.match(/^KoReasonKey = Literal\[([^\]]*)\]/m);
  assert.ok(literal, "matching.py no longer declares KoReasonKey as a Literal — chapter 3 lists its members");
  const known = new Set([...literal[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const scene = read("scenes/screening/ScreeningLadder.tsx");
  const block = scene.match(/const KO_REASONS = \[([\s\S]*?)\n\] as const;/);
  assert.ok(block, "could not find KO_REASONS in ScreeningLadder.tsx — update this test with its new shape");
  const shown = [...block[1].matchAll(/key: "([^"]+)"/g)].map((m) => m[1].replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  assert.ok(shown.length > 0, "parsed no KO_REASONS out of ScreeningLadder.tsx");
  assert.deepEqual(
    shown.filter((k) => !known.has(k)),
    [],
    "ScreeningLadder shows a gate reason ko_filter cannot produce"
  );

  // 120 / 74 / 8 are NOT constants anywhere — the shortlist width is the
  // caller's argument and the survival rate is whatever the applicants are. The
  // deck may use them as a worked example, but only while it says so.
  const note = copy("screening.figuresNote");
  for (const n of ["120", "74", "8"]) {
    assert.ok(note.includes(n), `about.screening.figuresNote must name ${n} as illustrative — it is not quoted from code`);
  }
});

test("chapter 5's baseline-similarity threshold is still the one the checker uses", () => {
  // artifact_checks.py writes the interview prompt at `sim >= 0.85`. The scene
  // renders AIM and the copy interpolates it, so both move together or the deck
  // promises a prompt at a number that no longer triggers one.
  const hit = pySource("pipeline/jobfit/devcase/artifact_checks.py").match(/if sim >= ([\d.]+):/);
  assert.ok(hit, "artifact_checks.py no longer gates the baseline-similarity prompt on a literal — re-pin this test");
  const aim = Number(hit[1]);
  assert.equal(aim, 0.85, "about.assignments.note and status.s9 are rendered with AIM");

  const scene = read("scenes/assignments/CaseBaseline.tsx");
  const declared = scene.match(/^const AIM = ([\d.]+);/m);
  assert.ok(declared, "CaseBaseline.tsx no longer declares AIM");
  assert.equal(Number(declared[1]), aim, "CaseBaseline's AIM and artifact_checks.py's gate are the same number");

  // And the scene's own number must sit below it, or the worked example
  // contradicts the sentence printed under it.
  const overlap = scene.match(/^const OVERLAP = ([\d.]+);/m);
  assert.ok(overlap, "CaseBaseline.tsx no longer declares OVERLAP");
  assert.ok(
    Number(overlap[1]) < aim,
    "the scene shows a submission that does NOT trip the prompt — its overlap has to sit below AIM"
  );
});

// ---- every path the deck prints ---------------------------------------------

test("every repo path the deck cites exists", () => {
  // These citations are the deck's audit trail: "quoted from
  // pipeline/jobfit/matching.py" is the one instruction a sceptical reader can
  // actually follow, and following it to a 404 teaches the opposite of what the
  // deck is trying to establish. `_SIBLING_MATCH` was cited to the wrong module
  // for exactly this reason, so the rule is now mechanical rather than careful.
  const files = [
    "chapters.ts",
    "chapters.test.ts",
    "AboutTab.tsx",
    "ChapterRail.tsx",
    "stage/clock.ts",
    "stage/motion.ts",
    "stage/parts.tsx",
    "stage/Scene.tsx",
    "stage/stages.ts",
    "stage/threads.ts",
    "stage/useSceneClock.ts",
    "scenes/shared.tsx",
    "scenes/status.ts",
    "scenes/jd/JdGrounding.tsx",
    "scenes/scoring/ScoringBuckets.tsx",
    "scenes/screening/ScreeningLadder.tsx",
    "scenes/archetypes/ArchetypeRouter.tsx",
    "scenes/assignments/CaseBaseline.tsx",
    "scenes/gates/GatesQueue.tsx",
  ];

  // A path-shaped token: a known repo root, then segments, ending in a real
  // extension. Deliberately narrow — a bare `data.ts` or `matching.py` is a
  // module NAME, not a path, and cannot be resolved without guessing.
  const CITATION = /\b(?:app|pipeline|messages|scripts|docs|data|e2e|packages)\/[\w./-]*\w\.(?:ts|tsx|py|json|md|mjs|css)\b/g;

  const missing: string[] = [];
  let checked = 0;
  for (const rel of files) {
    for (const m of read(rel).matchAll(CITATION)) {
      checked += 1;
      try {
        readFileSync(path.resolve(ROOT, m[0]));
      } catch {
        // Collected rather than thrown, so one run names every stale citation.
        missing.push(`${rel} cites ${m[0]}`);
      }
    }
  }

  assert.ok(checked > 0, "the path scanner matched nothing — its regex or the file list is stale");
  assert.deepEqual(missing, [], `the deck cites ${missing.length} path(s) that do not exist`);
});
