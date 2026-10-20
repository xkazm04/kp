import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { GIG_KNOWLEDGE_MAX, GIG_TYPE_KNOWLEDGE, type GigKnowledgeRef, type GigType } from "./gig-type";
import { manifestRegistryLocal, type RecipeResolveOptions } from "./recipes";

// The server half of gig-type.ts: a type's knowledge subjects resolved to their files
// through the registry's bundle index. Reads the filesystem, so it stays off every client
// graph; the vocabulary and the subject slugs live in gig-type.ts, which the UI imports.

/** The registry checkout for knowledge: the SAME precedence recipes.ts uses
 *  (`AI_REGISTRY_DIR`, else `.ai/manifest.yaml` `registry.local`, else `../ai-registry`,
 *  against the repo root), present when it carries a `knowledge/` folder. */
export function resolveKnowledgeRegistryDir(opts: RecipeResolveOptions = {}): string | null {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const env = opts.env ?? process.env;
  const configured = env.AI_REGISTRY_DIR?.trim() || manifestRegistryLocal(repoRoot) || "../ai-registry";
  const dir = path.resolve(repoRoot, configured);
  return existsSync(path.join(dir, "knowledge")) ? dir : null;
}

function readBundleIndex(registryDir: string, bundle: string): Record<string, { file?: unknown }> | null {
  if (!/^[a-z0-9-]+$/.test(bundle)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(registryDir, "knowledge", bundle, "index.json"), "utf8")) as { subjects?: unknown };
    return parsed.subjects && typeof parsed.subjects === "object" ? (parsed.subjects as Record<string, { file?: unknown }>) : null;
  } catch {
    // No index for the bundle (or unreadable): its subjects are dropped, never guessed.
    return null;
  }
}

/** The type's knowledge, each subject's golden-path file resolved through its bundle index.
 *  A subject the index does not carry - or no registry checkout at all - is DROPPED: a guessed
 *  path is worse than an absent subject. A `file` that would escape the checkout is dropped
 *  too. At most GIG_KNOWLEDGE_MAX. Reads only the index files. */
export function resolveGigTypeKnowledge(type: GigType, opts: RecipeResolveOptions & { registryDir?: string | null } = {}): GigKnowledgeRef[] {
  const wanted = GIG_TYPE_KNOWLEDGE[type];
  if (wanted.length === 0) return [];
  const registryDir = opts.registryDir === undefined ? resolveKnowledgeRegistryDir(opts) : opts.registryDir;
  if (!registryDir) return [];
  const indexes = new Map<string, Record<string, { file?: unknown }> | null>();
  const out: GigKnowledgeRef[] = [];
  for (const k of wanted) {
    if (!indexes.has(k.bundle)) indexes.set(k.bundle, readBundleIndex(registryDir, k.bundle));
    const entry = indexes.get(k.bundle)?.[k.subject];
    const file = entry && typeof entry.file === "string" && entry.file.trim() ? entry.file.trim().replace(/\\/g, "/") : null;
    if (!file) continue;
    const abs = path.resolve(registryDir, file);
    if (!abs.startsWith(path.resolve(registryDir) + path.sep)) continue;
    out.push({ bundle: k.bundle, subject: k.subject, path: file });
    if (out.length >= GIG_KNOWLEDGE_MAX) break;
  }
  return out;
}
