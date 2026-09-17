// Pins the GET /api/matrix Cell wire contract: the four CLI summary fields are
// declared optional on the route type, and a cell of only `{score, blocked}`
// still validates. Extra keys must not become required — that would reject the
// payload matrix_cli emits today ({score, blocked, koKeys?} only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUMMARY = ["fitTier?", "confidence?", "unprovenCount?", "provenanceMix?"] as const;

function routeSrc(): string {
  return readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

function cellTypeBody(src: string): string {
  const start = src.indexOf("type Cell =");
  const end = src.indexOf("type MatrixOut");
  assert.ok(start >= 0 && end > start, "Cell type alias must precede MatrixOut");
  return src.slice(start, end);
}

function isMatrixCell(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const c = raw as Record<string, unknown>;
  if (typeof c.blocked !== "boolean") return false;
  if (!(c.score === null || (typeof c.score === "number" && Number.isFinite(c.score)))) return false;
  return true;
}

test("route Cell type enumerates the four CLI summary fields as optional", () => {
  const body = cellTypeBody(routeSrc());
  for (const field of SUMMARY) {
    assert.ok(body.includes(field), `${field} must be optional on Cell`);
  }
  assert.match(body, /score:\s*number\s*\|\s*null/);
  assert.match(body, /blocked:\s*boolean/);
});

test("a cell with only score and blocked still validates; summary fields are additive", () => {
  const old = { score: 61, blocked: false };
  const blocked = { score: null, blocked: true, koKeys: ["language"] };
  const neu = {
    score: 61,
    blocked: false,
    fitTier: "strong",
    confidence: { low: 50, high: 72, level: "moderate" },
    unprovenCount: 2,
    provenanceMix: "mixed",
  };
  assert.equal(isMatrixCell(old), true);
  assert.equal(isMatrixCell(blocked), true);
  assert.equal(isMatrixCell(neu), true);
  assert.equal(isMatrixCell({ blocked: false }), false, "score is required");
  assert.equal(isMatrixCell({ score: 61 }), false, "blocked is required");
});

test("respond() still spreads the parsed matrix, so extra cell keys are not stripped", () => {
  const src = routeSrc();
  const respond = src.indexOf("const respond = (matrix: MatrixOut, cached: boolean)");
  assert.ok(respond >= 0, "respond() helper");
  const body = src.slice(respond, src.indexOf("const key = matrixCacheKey", respond));
  assert.match(body, /\.\.\.\s*matrix/);
});
