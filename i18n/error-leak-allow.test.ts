import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pins ERROR_LEAK_ALLOW in scripts/i18n-check.mjs: the set is a counted
// ceiling, every member exists on disk, and a comment cannot name an exemption
// that is not in the Set (the "Dev-facing studio" sentence used to).
//
// The script itself cannot be imported — it runs the gate at load — so this
// file reads the source. `npm run i18n:check` is the runtime half (size and
// existsSync fail the gate); this is the membership/comment half.
//
// Runner: node:test. `npm run test:unit i18n/error-leak-allow.test.ts`.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_PATH = path.join(REPO_ROOT, "scripts", "i18n-check.mjs");

function parseAllowlist(src: string): { max: number; entries: string[] } {
  const maxMatch = src.match(/ERROR_LEAK_ALLOW_MAX\s*=\s*(\d+)/);
  assert.ok(maxMatch, "ERROR_LEAK_ALLOW_MAX must be a named integer");
  const block = src.match(/const ERROR_LEAK_ALLOW = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "ERROR_LEAK_ALLOW Set literal must parse");
  const entries = [...block[1].matchAll(/"((?:app|scripts)\/[^"]+)"/g)].map((m) => m[1]);
  return { max: Number(maxMatch[1]), entries };
}

test("ERROR_LEAK_ALLOW is held to a named ceiling and every member exists on disk", () => {
  const src = readFileSync(SRC_PATH, "utf8").replace(/\r\n/g, "\n");
  const { max, entries } = parseAllowlist(src);
  assert.ok(max > 0, "ceiling must be a positive count");
  assert.ok(entries.length <= max, `size ${entries.length} exceeds ERROR_LEAK_ALLOW_MAX ${max}`);
  assert.equal(new Set(entries).size, entries.length, "allowlist must not repeat a path");
  for (const rel of entries) {
    assert.ok(existsSync(path.join(REPO_ROOT, rel)), `ERROR_LEAK_ALLOW names ${rel}, which is not on disk`);
  }
});

test("every comment in the allowlist block names a path that is in the Set", () => {
  const src = readFileSync(SRC_PATH, "utf8").replace(/\r\n/g, "\n");
  const { entries } = parseAllowlist(src);
  const block = src.match(/const ERROR_LEAK_ALLOW = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block);
  // The dangling "Dev-facing studio" sentence closed the Set with no studio
  // path listed — a later session could not tell forgotten vs migrated. Scoped
  // to COMMENT lines, not the whole block: a later Set entry can legitimately
  // live under a "-studio" path (app/features/setup-studio/...), and that
  // quoted string must not trip the same guard its own comment is held to —
  // the mentioned-path check below still catches an orphaned comment.
  const commentLines = block[1]
    .split("\n")
    .filter((line) => line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(commentLines, /studio/i, "studio comment has no matching Set member");
  const mentioned = [...block[1].matchAll(/((?:app|scripts)\/[\w./-]+\.tsx?)/g)].map((m) => m[1]);
  for (const rel of mentioned) {
    assert.ok(entries.includes(rel), `comment names ${rel} which is not in ERROR_LEAK_ALLOW`);
  }
});
