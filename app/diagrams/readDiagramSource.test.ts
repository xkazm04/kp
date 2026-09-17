// Guards the Architecture page's runtime asset contract (bug-hunter 2026-07-09 #1).
// The /diagrams page reads docs/diagrams/*.puml from disk at request time; under
// output:"standalone" those files only reach the runner because next.config.ts's
// `outputFileTracingIncludes` ships them. This test proves the read helper locates
// and returns the committed sources for the files the page actually renders, and
// that the resolver builds the docs/diagrams path the standalone runtime expects.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIAGRAMS } from "./diagramCatalog.ts";
import { readDiagramSource, diagramPath } from "./readDiagramSource.ts";

// app/diagrams/ -> repo root (two levels up), so the .puml sources resolve
// regardless of the test runner's cwd (mirrors pipelineSteps.test.ts).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The sources DiagramsPage renders — imported from the same catalog the page
// uses, so a rename in one place cannot leave this suite asserting a stale list.
const RENDERED = DIAGRAMS.map((d) => d.file);

test("readDiagramSource returns real PlantUML content for every rendered diagram", () => {
  for (const file of RENDERED) {
    const source = readDiagramSource(file, ROOT);
    assert.ok(source.length > 0, `${file}: read returned empty`);
    assert.match(source, /@startuml/, `${file}: not a PlantUML source`);
    assert.match(source, /@enduml/, `${file}: truncated PlantUML source`);
  }
});

test("diagramPath resolves under docs/diagrams relative to the standalone cwd", () => {
  // In the standalone build process.cwd() is the standalone root (WORKDIR /app),
  // and the trace-include lands the files at <root>/docs/diagrams/*.
  const p = diagramPath("15-automated-pipeline-tobe.puml", "/app");
  assert.equal(p, path.join("/app", "docs", "diagrams", "15-automated-pipeline-tobe.puml"));
});

test("a missing diagram falls back to empty string instead of throwing", () => {
  const original = console.error;
  console.error = () => {}; // the helper logs the failure; keep test output clean
  try {
    assert.equal(readDiagramSource("does-not-exist.puml", ROOT), "");
  } finally {
    console.error = original;
  }
});

// Committed sources that the operator page does not render. A new .puml that
// never reaches /diagrams must land here with a why, not as an omission — that
// is the ratchet so the unpublished subset cannot grow silently.
const UNLISTED: Record<string, string> = {
  "03-domain-model-v2.puml": "v2-plan class model; the operator page renders the live funnel and the v1/v2 overviews",
  "04-bau-candidate-analysis-v1.puml": "v1 analysis sequence; unpublished on /diagrams",
  "05-job-ingestion-pipeline.puml": "job-ad ingest activity; unpublished on /diagrams",
  "06-bau-matching-pipeline.puml": "BAU matching sequence; unpublished on /diagrams",
  "07-archetype-detection.puml": "archetype routing activity; unpublished on /diagrams",
  "08-student-intake.puml": "student intake activity; unpublished on /diagrams",
  "09-student-transformation.puml": "student transformation activity; unpublished on /diagrams",
  "10-student-scoring-reasoning.puml": "student scoring sequence; unpublished on /diagrams",
  "11-recruiter-outputs.puml": "recruiter-output activity; unpublished on /diagrams",
  "12-career-switcher.puml": "career-switcher activity; unpublished on /diagrams",
  "13-dev-case-lifecycle.puml": "dev-case lifecycle; unpublished on /diagrams",
  "14-dev-evaluation-model.puml": "dev-evaluation model; unpublished on /diagrams",
};

test("committed puml files equal DIAGRAMS plus an explicit UNLISTED set", () => {
  const onDisk = readdirSync(path.join(ROOT, "docs/diagrams"))
    .filter((f) => f.endsWith(".puml"))
    .sort();
  const rendered = [...RENDERED].sort();
  const unlisted = Object.keys(UNLISTED).sort();

  const blankWhy = Object.entries(UNLISTED)
    .filter(([, why]) => typeof why !== "string" || why.trim() === "")
    .map(([file]) => file);
  assert.deepEqual(blankWhy, [], `UNLISTED entries need a why string: ${blankWhy.join(", ")}`);

  const overlap = rendered.filter((f) => Object.hasOwn(UNLISTED, f));
  assert.deepEqual(overlap, [], `a file cannot be both rendered and UNLISTED: ${overlap.join(", ")}`);

  assert.deepEqual(
    [...rendered, ...unlisted].sort(),
    onDisk,
    "every committed .puml must be in DIAGRAMS or UNLISTED (with a why), and UNLISTED cannot name a missing file",
  );
});

test("next.config.ts traces every rendered puml into the standalone image", () => {
  const src = readFileSync(path.join(ROOT, "next.config.ts"), "utf8").replace(/\r\n/g, "\n");
  const block = src.match(/outputFileTracingIncludes:\s*\{[\s\S]*?\n  \},/);
  assert.ok(block, "next.config.ts must still declare outputFileTracingIncludes");
  const diagrams = block[0].match(/"\/diagrams"\s*:\s*\[([\s\S]*?)\]/);
  assert.ok(diagrams, "outputFileTracingIncludes must still include /diagrams");
  const globs = [...diagrams[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(globs.length > 0, "/diagrams tracing include is empty");
  const globCoversAll = globs.some((g) => /(^|\/)docs\/diagrams\/\*\.puml$/.test(g));
  if (globCoversAll) return;
  const missing = RENDERED.filter((file) => !globs.some((g) => g.endsWith(file) || g.includes(`/${file}`)));
  assert.deepEqual(
    missing,
    [],
    `/diagrams tracing include narrowed past the catalog: missing ${missing.join(", ")}`,
  );
});
