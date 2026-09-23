import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Where the live archetype registry lives, plus its byte digest. SERVER-ONLY, and a
// LEAF on purpose: the analyze cache key (analyze-run.ts, on every task-hub route
// graph) needs only the digest, while archetype-live.ts pulls the registry validator,
// its writer and the bundled taxonomy (+4 modules / ~38 KB on 24 routes, measured
// 2026-09-23). archetype-live.ts reads its path from here, so the two share one file.
//
// The digest is sha1 of the bytes, equal to archetype-live's digest for any file
// Python can import (archetype-live.test / cache-key.test pin that). It differs only
// for a readable-but-invalid file, which Python refuses at import — no analysis is
// produced, so none is cached under it. Not memoised: one read per analyze run, which
// spawns a Python process anyway.

/** The digest when the file cannot be read (same sentinel as archetype-live.ts). */
export const UNREADABLE_REGISTRY_FILE_DIGEST = "unreadable";

let pathOverride: string | null = null;

/** Tests only — set through archetype-live.ts setLiveRegistryPathForTest. */
export function setRegistryFilePathOverride(filePath: string | null): void {
  pathOverride = filePath;
}

/** The one file Python's registry.py reads. */
export function archetypeRegistryPath(): string {
  return pathOverride ?? path.join(process.cwd(), "pipeline", "jobfit", "archetypes.json");
}

/** sha1 of the registry bytes the next Python spawn will read — a cache-key axis. */
export function archetypeRegistryFileDigest(): string {
  try {
    return createHash("sha1").update(readFileSync(archetypeRegistryPath())).digest("hex");
  } catch {
    // unreadable: one fixed cache state (Python cannot run the analysis either)
    return UNREADABLE_REGISTRY_FILE_DIGEST;
  }
}
