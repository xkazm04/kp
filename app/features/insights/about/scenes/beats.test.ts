// The About deck's clock contract, executed.
//
// useSceneClock.ts states it: every scene is a deterministic integer clock
// driving a pure `sceneAt(phase)` in the scene's own `data.ts`, and `stillTick`
// is "the first tick at which every module has reached its final stage". Until
// each scene had a data.ts, the only guard was a regex over TSX that could read
// the status table but not a single reveal beat, so a scene could add a reveal
// after STILL and stay green. These cases import the beat tables instead and
// walk every phase of every cycle.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ModuleStage } from "../stage/stages.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Folder → the TSX that renders it. */
const SCENES = {
  jd: "JdGrounding.tsx",
  scoring: "ScoringBuckets.tsx",
  screening: "ScreeningLadder.tsx",
  archetypes: "ArchetypeRouter.tsx",
  assignments: "CaseBaseline.tsx",
  gates: "GatesQueue.tsx",
} as const;

type Value = boolean | ModuleStage;
type SceneValue = Value | readonly Value[];

type SceneData = {
  CYCLE: number;
  STILL: number;
  STATUS_BEATS: readonly number[];
  sceneAt: (phase: number) => Record<string, SceneValue>;
};

const RANK: Record<ModuleStage, number> = { ghost: 0, shell: 1, body: 2, detail: 3, chosen: 4 };
const isStage = (v: unknown): v is ModuleStage => typeof v === "string" && v in RANK;

async function load(dir: keyof typeof SCENES): Promise<SceneData> {
  const mod = (await import(`./${dir}/data.ts`)) as Partial<SceneData>;
  for (const name of ["CYCLE", "STILL", "STATUS_BEATS", "sceneAt"] as const) {
    assert.ok(mod[name] !== undefined, `scenes/${dir}/data.ts does not export ${name}`);
  }
  return mod as SceneData;
}

/**
 * One scene frame as `name -> number`: a flag is 0/1, a stage is its rank.
 * Per-row arrays flatten to `name[i]`, so a row that reveals late is named.
 */
function flatten(frame: Record<string, SceneValue>, where: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (key: string, v: unknown) => {
    if (typeof v === "boolean") out.set(key, v ? 1 : 0);
    else if (isStage(v)) out.set(key, RANK[v]);
    else assert.fail(`${where}: ${key} is ${JSON.stringify(v)}, not a reveal flag or a ModuleStage`);
  };
  for (const [key, v] of Object.entries(frame)) {
    if (Array.isArray(v)) v.forEach((x, i) => put(`${key}[${i}]`, x));
    else put(key, v);
  }
  return out;
}

for (const dir of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
  test(`${dir}: data.ts exports the beat table, with no TSX in its import graph`, async () => {
    const d = await load(dir);
    assert.ok(Number.isInteger(d.CYCLE) && d.CYCLE > 0, `${dir} CYCLE must be a positive integer`);
    assert.ok(Number.isInteger(d.STILL) && d.STILL >= 0 && d.STILL < d.CYCLE, `${dir} STILL must sit in [0, CYCLE)`);
    const src = readFileSync(path.join(HERE, dir, "data.ts"), "utf8");
    assert.doesNotMatch(src, /from\s+"[^"]*\.tsx"|from\s+"react"|from\s+"framer-motion"|from\s+"next-intl"/, `${dir}/data.ts must stay pure`);
  });

  test(`${dir}: sceneAt is total over [0, CYCLE)`, async () => {
    const d = await load(dir);
    const keys = [...flatten(d.sceneAt(0), `${dir}@0`).keys()];
    assert.ok(keys.length > 0, `${dir}: sceneAt(0) names no reveal flags or stages`);
    for (let p = 0; p < d.CYCLE; p++) {
      const frame = flatten(d.sceneAt(p), `${dir}@${p}`);
      assert.deepEqual([...frame.keys()], keys, `${dir}@${p}: sceneAt returned a different shape than at phase 0`);
    }
  });

  test(`${dir}: STILL is the complete-argument beat`, async () => {
    const d = await load(dir);
    const still = flatten(d.sceneAt(d.STILL), `${dir}@STILL`);
    const late: string[] = [];
    for (let p = 0; p < d.CYCLE; p++) {
      for (const [k, v] of flatten(d.sceneAt(p), `${dir}@${p}`)) {
        if (v > (still.get(k) ?? -1)) late.push(`${k} reaches ${v} at phase ${p}, STILL shows ${still.get(k)}`);
      }
    }
    assert.deepEqual([...new Set(late)], [], `${dir}: reduced-motion readers pinned at STILL=${d.STILL} miss part of the argument`);
  });

  test(`${dir}: STILL is the FIRST complete-argument beat`, async () => {
    const d = await load(dir);
    if (d.STILL === 0) return;
    const before = flatten(d.sceneAt(d.STILL - 1), `${dir}@STILL-1`);
    const still = flatten(d.sceneAt(d.STILL), `${dir}@STILL`);
    assert.notDeepEqual(
      before,
      still,
      `${dir}: sceneAt(${d.STILL - 1}) already equals sceneAt(STILL=${d.STILL}) — the still frame is one beat late (useSceneClock: "the first tick at which every module has reached its final stage")`,
    );
  });

  test(`${dir}: every status beat lands in [0, STILL]`, async () => {
    const d = await load(dir);
    assert.ok(d.STATUS_BEATS.length > 0, `${dir} declares no status beats`);
    assert.ok(d.STATUS_BEATS.includes(0), `${dir} must say something at beat 0 — the clock rewinds there`);
    for (const b of d.STATUS_BEATS) {
      assert.ok(Number.isInteger(b) && b >= 0 && b <= d.STILL, `${dir} status beat ${b} is outside [0, STILL=${d.STILL}]`);
    }
  });
}

test("chapters.test.ts pins scene constants by import, never by regex over scene TSX", () => {
  const src = readFileSync(path.join(HERE, "..", "chapters.test.ts"), "utf8");
  // A direct `read(<scene tsx>)` is a constant about to be extracted from
  // source text. The citation scan still reads scene files as text — that is
  // its job — but through `read(rel)` over its file list, never by name.
  const reads = src.match(/\bread\((?:SCENE|GATES|"scenes\/[^"]+\.tsx")\)/g) ?? [];
  assert.deepEqual(reads, [], "chapters.test.ts still extracts scene constants from TSX source");
});
