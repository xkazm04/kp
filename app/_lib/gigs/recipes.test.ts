// Recipe resolution (recipes.ts): per-slug registry-then-seed, against throwaway
// registry checkouts in a temp dir. No network; the real registry is never read.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GIG_ARENAS } from "./types.ts";
import {
  GIG_ARENA_RECIPE,
  GIG_SEED_RECIPES,
  GIG_SEED_RECIPE_VERSION,
  gigRecipeIndexPaths,
  gigRecipeSlugs,
  manifestRegistryLocal,
  resolveGigRecipes,
  resolveRegistryDir,
} from "./recipes.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "kp-gig-recipes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let seq = 0;
/** A fake repo root + registry checkout holding `slugs` (each with a recipe.json). */
function fixture(slugs: string[] | null, manifest: string | null = "registry:\n  remote: github:x/y\n  local: ../reg\n"): { repoRoot: string; env: Record<string, string | undefined> } {
  seq += 1;
  const base = path.join(tmp, `case-${seq}`);
  const repoRoot = path.join(base, "repo");
  mkdirSync(path.join(repoRoot, ".ai"), { recursive: true });
  if (manifest !== null) writeFileSync(path.join(repoRoot, ".ai", "manifest.yaml"), manifest);
  if (slugs !== null) {
    const reg = path.join(base, "reg");
    const index: Record<string, unknown> = {};
    for (const slug of slugs) {
      const rel = `recipes/general_professional/client-engagements/${slug}`;
      mkdirSync(path.join(reg, rel), { recursive: true });
      index[slug] = { path: rel, version: "0.3.2", title: `Title ${slug}` };
      writeFileSync(
        path.join(reg, rel, "recipe.json"),
        JSON.stringify({
          slug,
          title: `Recipe ${slug}`,
          version: "0.3.2",
          description: { need: `Need of ${slug}.`, core_action: `Core of ${slug}.` },
          outcomes: [
            { id: "a", statement: "s", success_criteria: [`${slug} criterion 1`, `${slug} criterion 2`] },
            { id: "b", statement: "s", success_criteria: [`${slug} criterion 3`] },
          ],
          guidance: `Guidance for ${slug}.`,
          activities: [{ id: "x", label: `Activity of ${slug}`, kind: "act" }, { id: "y", kind: "act" }],
        })
      );
    }
    mkdirSync(path.join(reg, "recipes"), { recursive: true });
    writeFileSync(path.join(reg, "recipes", "index.json"), JSON.stringify({ meta: {}, recipes: index }));
  }
  return { repoRoot, env: {} };
}

test("each arena adopts its own recipe first, then the four shared ones including the retrospective", () => {
  for (const arena of GIG_ARENAS) {
    const slugs = gigRecipeSlugs(arena);
    assert.equal(slugs[0], GIG_ARENA_RECIPE[arena]);
    assert.equal(slugs.length, 5);
    assert.ok(slugs.includes("paid-work-outcome-retrospective"), `${arena} adopts the retrospective`);
    for (const s of slugs) assert.ok(GIG_SEED_RECIPES[s], `${s} has a seed entry`);
  }
});

test("registry present with every slug: all resolve from it, registry available", () => {
  const all = [...new Set(GIG_ARENAS.flatMap((a) => gigRecipeSlugs(a)))];
  const opts = fixture(all);
  const r = resolveGigRecipes("competition", opts);
  assert.equal(r.registry, "available");
  assert.ok(r.registryDir);
  assert.equal(r.recipes.length, 5);
  for (const rec of r.recipes) {
    assert.equal(rec.origin, "registry");
    assert.equal(rec.ref.version, "0.3.2", "the version is pinned from the index");
  }
  const first = r.recipes[0]!;
  assert.equal(first.ref.slug, "data-competition-entry");
  assert.equal(first.need, "Need of data-competition-entry.");
  assert.equal(first.coreAction, "Core of data-competition-entry.");
  assert.equal(first.guidance, "Guidance for data-competition-entry.");
  assert.deepEqual(first.activities, ["Activity of data-competition-entry"], "labelled activities only, in order");
  assert.deepEqual(first.successCriteria, [
    "data-competition-entry criterion 1",
    "data-competition-entry criterion 2",
    "data-competition-entry criterion 3",
  ]);
});

test("registry present with SOME slugs (today's registry): per-slug origin, registry unavailable", () => {
  // The five authored in the registry as of 2026-09-24 (616556b9).
  const opts = fixture([
    "data-competition-entry",
    "freelance-brief-delivery",
    "disclosed-proposal-writing",
    "pre-send-deliverable-verification",
    "paid-work-outcome-retrospective",
  ]);
  const comp = resolveGigRecipes("competition", opts);
  const origin = Object.fromEntries(comp.recipes.map((r) => [r.ref.slug, r.origin]));
  assert.deepEqual(origin, {
    "data-competition-entry": "registry",
    "paid-work-opportunity-qualification": "seed",
    "disclosed-proposal-writing": "registry",
    "pre-send-deliverable-verification": "registry",
    "paid-work-outcome-retrospective": "registry",
  });
  assert.equal(comp.registry, "unavailable", "one seeded slug makes the specialist not registry-complete");
  const seeded = comp.recipes.find((r) => r.origin === "seed")!;
  assert.equal(seeded.ref.version, GIG_SEED_RECIPE_VERSION);
  assert.equal(seeded.need, GIG_SEED_RECIPES["paid-work-opportunity-qualification"]!.need);
  assert.equal(seeded.guidance, null);
  assert.deepEqual(seeded.successCriteria, []);
  assert.deepEqual(seeded.activities, []);

  const sec = resolveGigRecipes("security", opts);
  assert.equal(sec.recipes[0]!.origin, "seed", "bug-bounty-vulnerability-report is not authored yet");
});

test("registry present with NONE of the slugs: every slug seeds", () => {
  const r = resolveGigRecipes("freelance", fixture(["some-other-recipe"]));
  assert.ok(r.recipes.every((x) => x.origin === "seed"));
  assert.equal(r.registry, "unavailable");
  assert.ok(r.registryDir, "the registry was found, it just carries none of these");
});

test("registry absent: the seed map, registry unavailable, no dir", () => {
  const r = resolveGigRecipes("oss_bounty", fixture(null));
  assert.equal(r.registry, "unavailable");
  assert.equal(r.registryDir, null);
  assert.deepEqual(
    r.recipes.map((x) => [x.ref.slug, x.ref.version, x.origin]),
    gigRecipeSlugs("oss_bounty").map((s) => [s, GIG_SEED_RECIPE_VERSION, "seed"])
  );
  for (const x of r.recipes) assert.ok(x.need.length > 20, `${x.ref.slug} carries its one-line need`);
});

test("a listed slug whose recipe.json is missing seeds alone", () => {
  const opts = fixture(["data-competition-entry", "disclosed-proposal-writing"]);
  rmSync(path.join(opts.repoRoot, "..", "reg", "recipes/general_professional/client-engagements/disclosed-proposal-writing", "recipe.json"));
  const r = resolveGigRecipes("competition", opts);
  assert.equal(r.recipes.find((x) => x.ref.slug === "data-competition-entry")!.origin, "registry");
  assert.equal(r.recipes.find((x) => x.ref.slug === "disclosed-proposal-writing")!.origin, "seed");
});

test("AI_REGISTRY_DIR beats the manifest; the manifest beats the default", () => {
  const opts = fixture(["data-competition-entry"], null);
  // No manifest -> default ../ai-registry, which does not exist beside this fake repo.
  assert.equal(resolveRegistryDir(opts), null);
  const reg = path.join(opts.repoRoot, "..", "reg");
  assert.equal(resolveRegistryDir({ ...opts, env: { AI_REGISTRY_DIR: reg } }), path.resolve(reg));
  assert.equal(resolveGigRecipes("competition", { ...opts, env: { AI_REGISTRY_DIR: reg } }).recipes[0]!.origin, "registry");
});

test("manifestRegistryLocal reads registry.local and nothing else", () => {
  const { repoRoot } = fixture(null, "knowledge:\n  local: ../wrong\nregistry:\n  remote: github:x/y\n  local: ../ai-registry # the default\nskills: []\n");
  assert.equal(manifestRegistryLocal(repoRoot), "../ai-registry");
  const quoted = fixture(null, 'registry:\n  local: "../quoted reg"\n');
  assert.equal(manifestRegistryLocal(quoted.repoRoot), "../quoted reg");
  assert.equal(manifestRegistryLocal(fixture(null, null).repoRoot), null);
});

test("an index path escaping the checkout is refused (seeds instead)", () => {
  const opts = fixture(["data-competition-entry"]);
  const reg = path.join(opts.repoRoot, "..", "reg");
  writeFileSync(
    path.join(reg, "recipes", "index.json"),
    JSON.stringify({ recipes: { "data-competition-entry": { path: "../../../../etc", version: "9.9.9" } } })
  );
  assert.equal(resolveGigRecipes("competition", opts).recipes[0]!.origin, "seed");
});

test("gigRecipeIndexPaths: the index's registry-relative folder per slug, null when unlisted or no registry (WP4)", () => {
  const f = fixture(["paid-work-outcome-retrospective"]);
  assert.deepEqual(gigRecipeIndexPaths(["paid-work-outcome-retrospective", "bug-bounty-vulnerability-report"], f), {
    "paid-work-outcome-retrospective": "recipes/general_professional/client-engagements/paid-work-outcome-retrospective",
    "bug-bounty-vulnerability-report": null,
  });
  const none = fixture(null, null);
  assert.deepEqual(gigRecipeIndexPaths(["paid-work-outcome-retrospective"], { ...none, env: { AI_REGISTRY_DIR: path.join(tmp, "absent") } }), {
    "paid-work-outcome-retrospective": null,
  });
});
