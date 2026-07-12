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
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readDiagramSource, diagramPath } from "./readDiagramSource.ts";

// app/diagrams/ -> repo root (two levels up), so the .puml sources resolve
// regardless of the test runner's cwd (mirrors pipelineSteps.test.ts).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The three sources DiagramsPage renders (page.tsx DIAGRAMS[]). These are exactly
// the files that must survive the trip into the standalone image.
const RENDERED = [
  "15-automated-pipeline-tobe.puml",
  "01-system-architecture-v1.puml",
  "02-system-architecture-v2.puml",
];

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
