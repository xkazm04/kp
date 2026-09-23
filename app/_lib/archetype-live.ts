import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isFairnessProtected, isKnownArchetype, normalizeArchetype, shieldsFromAutoReject } from "./archetypes";
import { parseRegistryDocument, registryWriteGeneration } from "./archetype-registry";

// The LIVE archetype registry, for server decisions. SERVER-ONLY (node:fs).
//
// pipeline/jobfit/archetypes.json has one editable copy but used to have two physical
// reads: Python re-reads it on every spawn (registry.py), while app/_lib/archetypes.ts
// answers from a copy bundled at BUILD time. The file is rewritten at runtime by the
// archetype manager (archetype-registry.ts writeRegistry: new custom archetypes, a
// custom archetype's shield switched on, a built-in reweighted), so every TS decision
// that keyed on the bundle lagged the engine it sits beside until the next deploy:
// the auto-reject shield called a registered archetype "unknown", and the scored-grid
// cache served a pre-reweight grid. Every server reader that DECIDES or CACHES on the
// registry reads through here:
//   - screen-wave.ts          the auto-reject eligibility + unknown-archetype audit
//   - automation-fairness.ts  the TS re-check of Python's reject decisions
//   - api/matrix/route.ts     the grid cache key (archetypeRegistryDigest)
// archetypes.ts keeps its client-safe exports (labels, display grouping) unchanged.
//
// Contract:
//   - memoised on (path, mtime, size, registryWriteGeneration), so a read is one stat;
//   - validated through the SAME parser the manager and Python's import-time guard
//     enforce (archetype-registry.ts parseRegistryDocument), so this reader trusts
//     exactly what Python will score with;
//   - the shield is a UNION: shielded when the BUNDLE shields it, when the live file
//     shields it (shieldsFromAutoReject — the one rule both readers share), or when
//     neither registry knows the id (fail closed). It can only ever add protection
//     for any id the bundle knows. A live-only id is answered by its own live entry —
//     that is the point: its shield is whatever the operator registered;
//   - an unreadable / invalid file never throws: the bundled gate answers, a live-only
//     id is unknown (so shielded), and the digest is the fixed sentinel below.

/** The digest when the file cannot be read, parsed or validated. Fixed, so a broken
 *  registry is ONE cache state rather than a key that shifts with the error text. */
export const UNREADABLE_REGISTRY_DIGEST = "unreadable";

export type LiveArchetypes = {
  /** sha1 of the registry bytes, or {@link UNREADABLE_REGISTRY_DIGEST}. */
  readonly digest: string;
  /** Known to the bundle OR the live file. */
  isKnown(archetype: string | null | undefined): boolean;
  /** The fail-closed auto-reject shield (see the contract above). */
  isFairnessProtected(archetype: string | null | undefined): boolean;
};

let pathOverride: string | null = null;

/** Point the reader at another file (tests only — the deployment reads the one file
 *  Python reads, and a production knob here would let the two runtimes diverge). */
export function setLiveRegistryPathForTest(filePath: string | null): void {
  pathOverride = filePath;
  invalidateLiveRegistry();
}

function livePath(): string {
  return pathOverride ?? path.join(process.cwd(), "pipeline", "jobfit", "archetypes.json");
}

let memo: { stamp: string; live: LiveArchetypes } | null = null;

/** Drop the memo, so the next read re-reads the file. writeRegistry's own saves are
 *  covered without calling this (registryWriteGeneration is part of the memo key). */
export function invalidateLiveRegistry(): void {
  memo = null;
}

function build(digest: string, known: ReadonlySet<string>, shielded: ReadonlySet<string>): LiveArchetypes {
  return {
    digest,
    isKnown(archetype) {
      return isKnownArchetype(archetype) || known.has(normalizeArchetype(archetype));
    },
    isFairnessProtected(archetype) {
      const id = normalizeArchetype(archetype);
      // Bundled gate first: it is true for every id the bundle shields AND for every
      // id it does not know — the latter is re-decided below only when the live file
      // knows the id, which is what lets a registered custom archetype be classified.
      if (isKnownArchetype(id)) return isFairnessProtected(id) || shielded.has(id);
      if (known.has(id)) return shielded.has(id);
      return true;
    },
  };
}

const UNREADABLE: LiveArchetypes = build(UNREADABLE_REGISTRY_DIGEST, new Set(), new Set());

/** One consistent read of the live registry. A caller that decides several entries
 *  (a screening wave) takes ONE snapshot so every row is judged by the same file. */
export function readLiveArchetypes(): LiveArchetypes {
  const file = livePath();
  let stamp: string;
  try {
    const st = statSync(file);
    stamp = `${file}\u0000${st.mtimeMs}\u0000${st.size}\u0000${registryWriteGeneration()}`;
  } catch {
    // fail closed: no file -> the bundled gate answers, live-only ids stay shielded
    memo = null;
    return UNREADABLE;
  }
  if (memo && memo.stamp === stamp) return memo.live;
  let live: LiveArchetypes = UNREADABLE;
  try {
    const bytes = readFileSync(file);
    const reg = parseRegistryDocument(bytes.toString("utf8"));
    const known = new Set<string>();
    const shielded = new Set<string>();
    for (const a of reg.archetypes) {
      const id = normalizeArchetype(a.id);
      known.add(id);
      if (shieldsFromAutoReject(a)) shielded.add(id);
    }
    live = build(createHash("sha1").update(bytes).digest("hex"), known, shielded);
  } catch {
    // fail closed: unreadable / invalid JSON / fails the validator -> the bundled gate
    live = UNREADABLE;
  }
  memo = { stamp, live };
  return live;
}

/** Content digest of the registry the Python scorer will read — a cache-key axis. */
export function archetypeRegistryDigest(): string {
  return readLiveArchetypes().digest;
}

export function liveIsKnownArchetype(archetype: string | null | undefined): boolean {
  return readLiveArchetypes().isKnown(archetype);
}

export function isFairnessProtectedLive(archetype: string | null | undefined): boolean {
  return readLiveArchetypes().isFairnessProtected(archetype);
}
