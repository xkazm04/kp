import { readFileSync } from "node:fs";
import { join } from "node:path";

// The .puml sources the Architecture page renders live in docs/diagrams/. They
// are read from disk server-side at request time (not imported), so under
// output:"standalone" they are invisible to Next's static file-tracing and would
// be absent from the runner — unless next.config.ts's `outputFileTracingIncludes`
// explicitly ships `docs/diagrams/*.puml` into the standalone bundle. See the
// matching entry there.
//
// Resolution note: in the standalone build `process.cwd()` is the standalone
// root — the directory that holds `server.js` (WORKDIR /app in the Dockerfile).
// The tracing-include copies the files to `<standalone-root>/docs/diagrams/*`, so
// `join(process.cwd(), "docs", "diagrams", file)` resolves at runtime exactly as
// it does from the repo root in `next dev`.

/** Absolute path a diagram source resolves to, given a base dir (defaults to the
 *  process working directory = the standalone root in production). Split out so a
 *  test can pin the base dir and assert the layout without relying on cwd. */
export function diagramPath(file: string, baseDir: string = process.cwd()): string {
  return join(baseDir, "docs", "diagrams", file);
}

// docs/diagrams/*.puml are committed build artifacts: in production they never
// change at runtime, so reading them from disk on every (blocked/dynamic) request
// is pure repeated I/O. Cache each read by filename in module scope. In
// development we always re-read so edits to the .puml sources show up live without
// a restart. A failed read is never cached, so a file that appears later still
// recovers.
const sourceCache = new Map<string, string>();

/** Read a committed PlantUML source by filename. Returns "" (never throws) if the
 *  file can't be read, so the page can fall back to an honest "Could not read …"
 *  message instead of crashing — but a failed read is logged so a prod outage is
 *  diagnosable rather than silent. */
export function readDiagramSource(file: string, baseDir: string = process.cwd()): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const cached = sourceCache.get(file);
    if (cached !== undefined) return cached;
  }
  const abs = diagramPath(file, baseDir);
  let source: string;
  try {
    source = readFileSync(abs, "utf8");
  } catch (err) {
    // Surface the failure — the on-page "Could not read" box is honest but easy
    // to miss; a server-side log makes a missing-asset regression traceable.
    console.error(`[diagrams] could not read ${abs}:`, (err as Error)?.message ?? err);
    return "";
  }
  if (isProd) sourceCache.set(file, source);
  return source;
}
