import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GigArena, RecipeRef } from "./types";

// Recipe resolution for gig specialists - what craft a specialist adopts, and the text
// of it. A specialist is composed from registry RECIPES (the organization's ai-registry,
// `recipes/` lane): the arena's own recipe plus the paid-work recipes every arena shares.
//
// Resolution is PER SLUG. The registry checkout is found through `AI_REGISTRY_DIR`, else
// `.ai/manifest.yaml` `registry.local` (default `../ai-registry`), resolved against the
// repo root. A slug listed in `<registry>/recipes/index.json` resolves from its
// recipe.json (version pinned from the index, need / core action / guidance / success
// criteria from the file). A slug the index does not carry - or whose file cannot be
// read - resolves from the built-in SEED MAP below at 0.1.0 with a one-line need, and
// is marked `origin: "seed"` on its own record. The registry counts as "available" for a
// specialist only when EVERY adopted slug came from it; a half-seeded specialist says so.
//
// Keyless and offline by construction: no network, no model. A missing registry is the
// normal state of a fresh self-hosted clone, not an error.

/** Every arena adopts these beside its own recipe. */
export const GIG_SHARED_RECIPES = [
  "paid-work-opportunity-qualification",
  "disclosed-proposal-writing",
  "pre-send-deliverable-verification",
  "paid-work-outcome-retrospective",
] as const;

/** The arena's own recipe - the craft the specialist's mission is drawn from. */
export const GIG_ARENA_RECIPE: Readonly<Record<GigArena, string>> = {
  security: "bug-bounty-vulnerability-report",
  oss_bounty: "open-source-bounty-contribution",
  competition: "data-competition-entry",
  freelance: "freelance-brief-delivery",
};

/** The version a seed-resolved slug is pinned at. */
export const GIG_SEED_RECIPE_VERSION = "0.1.0";

/** The built-in seed: one line of need per slug, used when the registry does not carry
 *  the slug (or is absent). Deliberately thin - the registry is where the craft lives. */
export const GIG_SEED_RECIPES: Readonly<Record<string, { title: string; need: string }>> = {
  "bug-bounty-vulnerability-report": {
    title: "Bug bounty vulnerability report",
    need: "A finding is paid only when a triager can reproduce it inside the program's scope and its impact is stated honestly.",
  },
  "open-source-bounty-contribution": {
    title: "Open-source bounty contribution",
    need: "A bounty is paid for a small, tested change a maintainer can merge under the project's own rules, claimed the way the bounty asks.",
  },
  "data-competition-entry": {
    title: "Data competition entry",
    need: "An entry places on the final leaderboard only when local validation forecasts the hidden score and the result is reproducible and within the rules.",
  },
  "freelance-brief-delivery": {
    title: "Freelance client brief delivery",
    need: "A client pays for a deliverable that answers every requirement of the brief within an honestly stated scope.",
  },
  "paid-work-opportunity-qualification": {
    title: "Paid work opportunity qualification",
    need: "Time is spent only on work whose reward, deadline and fit make an accepted result plausible, and suspicious listings are left alone.",
  },
  "disclosed-proposal-writing": {
    title: "Disclosed proposal writing",
    need: "A proposal wins trust when it answers the brief specifically, claims nothing untrue and discloses the AI assistance behind it.",
  },
  "pre-send-deliverable-verification": {
    title: "Pre-send deliverable verification",
    need: "Nothing goes out until it has been checked against the brief, run where it can be run, and every claim in it is backed.",
  },
  "paid-work-outcome-retrospective": {
    title: "Paid work outcome retrospective",
    need: "Each accepted or rejected result teaches a generalizable lesson that sharpens the next attempt.",
  },
};

/** The slugs an arena's specialist adopts, arena recipe first. */
export function gigRecipeSlugs(arena: GigArena): string[] {
  return [GIG_ARENA_RECIPE[arena], ...GIG_SHARED_RECIPES];
}

export type ResolvedGigRecipe = {
  ref: RecipeRef;
  origin: "registry" | "seed";
  title: string;
  need: string;
  /** The recipe's core action; null for a seed-resolved slug. */
  coreAction: string | null;
  /** The recipe's guidance paragraph; null for a seed-resolved slug. */
  guidance: string | null;
  /** Every outcome's success criteria, flattened in order; [] for a seed slug. */
  successCriteria: string[];
};

export type ResolvedGigRecipes = {
  recipes: ResolvedGigRecipe[];
  /** "available" only when every adopted slug resolved from the registry. */
  registry: "available" | "unavailable";
  /** The registry checkout that was read; null when none was found. */
  registryDir: string | null;
};

export type RecipeResolveOptions = {
  /** Repo root the manifest path resolves against (default: process.cwd()). */
  repoRoot?: string;
  /** Environment to read AI_REGISTRY_DIR from (default: process.env). */
  env?: Record<string, string | undefined>;
};

/** `registry.local` from `.ai/manifest.yaml`, read with a line scan (the repo carries
 *  no YAML parser and the key is one scalar). Null when the file or key is absent. */
export function manifestRegistryLocal(repoRoot: string): string | null {
  let text: string;
  try {
    text = readFileSync(path.join(repoRoot, ".ai", "manifest.yaml"), "utf8");
  } catch {
    // No manifest: the caller falls back to the documented default path.
    return null;
  }
  let inRegistry = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\S/.test(raw)) inRegistry = /^registry:\s*(#.*)?$/.test(raw);
    else if (inRegistry) {
      const m = /^\s+local:\s*["']?([^"'#\s][^"'#]*?)["']?\s*(#.*)?$/.exec(raw);
      if (m) return m[1]!.trim();
    }
  }
  return null;
}

/** The registry checkout directory, or null when it does not exist on this machine. */
export function resolveRegistryDir(opts: RecipeResolveOptions = {}): string | null {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const env = opts.env ?? process.env;
  const fromEnv = env.AI_REGISTRY_DIR?.trim();
  const configured = fromEnv || manifestRegistryLocal(repoRoot) || "../ai-registry";
  const dir = path.resolve(repoRoot, configured);
  return existsSync(path.join(dir, "recipes", "index.json")) ? dir : null;
}

type IndexEntry = { path?: unknown; version?: unknown; title?: unknown };

function readIndex(registryDir: string): Record<string, IndexEntry> | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(registryDir, "recipes", "index.json"), "utf8")) as { recipes?: unknown };
    return parsed.recipes && typeof parsed.recipes === "object" ? (parsed.recipes as Record<string, IndexEntry>) : null;
  } catch {
    // An unreadable index is the same as no registry: every slug seeds.
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function seedRecipe(slug: string): ResolvedGigRecipe {
  const seed = GIG_SEED_RECIPES[slug];
  return {
    ref: { slug, version: GIG_SEED_RECIPE_VERSION },
    origin: "seed",
    title: seed?.title ?? slug,
    need: seed?.need ?? "",
    coreAction: null,
    guidance: null,
    successCriteria: [],
  };
}

/** One slug from the registry, or null when the index or the file cannot serve it. */
function registryRecipe(registryDir: string, index: Record<string, IndexEntry>, slug: string): ResolvedGigRecipe | null {
  const entry = index[slug];
  const rel = entry ? str(entry.path) : null;
  if (!entry || !rel) return null;
  // The index path is data from another repository: refuse one that escapes the checkout.
  const file = path.resolve(registryDir, rel, "recipe.json");
  if (!file.startsWith(path.resolve(registryDir) + path.sep)) return null;
  let recipe: Record<string, unknown>;
  try {
    recipe = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // Listed but unreadable (a partial checkout): this slug seeds, the rest do not.
    return null;
  }
  const description = recipe.description && typeof recipe.description === "object" ? (recipe.description as Record<string, unknown>) : {};
  const outcomes = Array.isArray(recipe.outcomes) ? recipe.outcomes : [];
  const successCriteria: string[] = [];
  for (const o of outcomes) {
    const crit = o && typeof o === "object" ? (o as { success_criteria?: unknown }).success_criteria : null;
    if (Array.isArray(crit)) for (const c of crit) if (str(c)) successCriteria.push(str(c)!);
  }
  return {
    ref: { slug, version: str(entry.version) ?? str(recipe.version) ?? GIG_SEED_RECIPE_VERSION },
    origin: "registry",
    title: str(recipe.title) ?? str(entry.title) ?? GIG_SEED_RECIPES[slug]?.title ?? slug,
    need: str(description.need) ?? GIG_SEED_RECIPES[slug]?.need ?? "",
    coreAction: str(description.core_action),
    guidance: str(recipe.guidance),
    successCriteria,
  };
}

/** Resolve an arena's adopted recipes, per slug, registry first then seed. */
export function resolveGigRecipes(arena: GigArena, opts: RecipeResolveOptions = {}): ResolvedGigRecipes {
  const slugs = gigRecipeSlugs(arena);
  const registryDir = resolveRegistryDir(opts);
  const index = registryDir ? readIndex(registryDir) : null;
  const recipes = slugs.map((slug) => (registryDir && index ? registryRecipe(registryDir, index, slug) : null) ?? seedRecipe(slug));
  return {
    recipes,
    registry: recipes.every((r) => r.origin === "registry") ? "available" : "unavailable",
    registryDir: index ? registryDir : null,
  };
}
