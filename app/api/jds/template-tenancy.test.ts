// Tenancy guard for JD template resolution. getTemplate has a defaulted
// workspaceId, so a bare getTemplate(templateId) reads the DEFAULT team's
// templates — silently discarding a non-default team's private template choice
// on Generate/Retry AND letting any team read a default-team private template by
// id (templates-isolation.test.ts pins the store's WHERE guard; these two call
// sites bypassed it). The routes run behind cookie auth, so this is a SOURCE
// GUARD that both resolve the workspace and thread it into getTemplate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(dir, rel), "utf8");

test("POST /api/jds/generate resolves the template in the caller's workspace and 400s an unresolved id", () => {
  const src = read("generate/route.ts");
  assert.match(src, /getTemplate\([^)]*\bws\b[^)]*\)/, "generate must pass the workspace to getTemplate");
  assert.doesNotMatch(src, /getTemplate\(templateId\)/, "generate must not call getTemplate with a bare id");
  // A non-empty templateId that no longer resolves must 400, not silently fall back.
  assert.match(src, /no longer available/i, "generate must 400 when the chosen template is gone");
});

test("POST /api/jds/[slug]/retry-analysis resolves the stored template in the JD's workspace", () => {
  const src = read("[slug]/retry-analysis/route.ts");
  assert.match(src, /getTemplate\([^)]*workspaceId[^)]*\)/, "retry must pass the workspace to getTemplate");
  assert.doesNotMatch(src, /getTemplate\(intent\.templateId\)/, "retry must not call getTemplate with a bare id");
});
