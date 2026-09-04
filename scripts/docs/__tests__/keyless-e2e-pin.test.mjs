// KEYLESS E2E SUBSET — one list, three readers.
//
// WHAT THIS EXISTS TO CATCH. The specs that certify "degrades gracefully
// keyless" existed as eight positional arguments inside a ci.yml `run:` block
// and nowhere else. Two consequences, both silent:
//   • adding a keyless spec means remembering to edit a YAML step. Forgetting
//     does not fail anything — the spec simply never runs in the release gate,
//     and the job stays green.
//   • `.claude/CLAUDE.md` restated the subset in prose and had ALREADY drifted:
//     it named `app-master-hire`, which needs KP_APP_MASTER_REPO_ROOTS on the
//     server and is not in the job at all, while omitting four specs that are.
//
// KEYLESS_SPECS in playwright.config.ts is now the list. This pins the other two
// readers to it IN BOTH DIRECTIONS, so neither adding to the workflow without
// declaring it nor declaring one the workflow does not run can pass.
//
// Reads sources as TEXT rather than importing them: playwright.config.ts pulls
// in @playwright/test and dotenv, which is not something a consistency check
// should boot, and ci.yml is YAML this repo has no parser dependency for.
//
// Runner: plain node:test, no deps — `npm run test:docs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Normalized: this checkout is CRLF in the working tree (see .gitattributes),
// and every pattern below is written against LF.
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** The declared list, parsed out of the config source. */
function declaredSpecs() {
  const src = read("playwright.config.ts");
  const m = src.match(/export const KEYLESS_SPECS = \[([\s\S]*?)\] as const;/);
  assert.ok(m, "playwright.config.ts must export a KEYLESS_SPECS array literal");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The filters the release job actually passes to playwright. */
function workflowSpecs() {
  const src = read(".github/workflows/ci.yml");
  const step = src.match(/- name: Run deterministic specs\n([\s\S]*?)\n\n/);
  assert.ok(step, "ci.yml must still carry a 'Run deterministic specs' step");
  return step[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    // Drop the yaml scaffolding and playwright's own flags — what is left is the
    // positional file filters.
    .filter((l) => !/^(run:|npx playwright test|env:|KP_E2E_BASE_URL:)/.test(l) && !l.startsWith("--"));
}

test("the workflow's deterministic-spec filters are exactly KEYLESS_SPECS", () => {
  const declared = declaredSpecs();
  // Non-vacuity on both sides: an empty parse would make the comparison trivial.
  assert.ok(declared.length >= 5, `KEYLESS_SPECS looks empty (${declared.length}) — the parse is broken`);
  const inCi = workflowSpecs();
  assert.ok(inCi.length >= 5, `parsed ${inCi.length} filters out of ci.yml — the parse is broken, not the workflow`);

  assert.deepEqual(
    inCi,
    declared,
    `ci.yml's deterministic-spec filters and playwright.config.ts's KEYLESS_SPECS have diverged.\n` +
      `  ci.yml:   ${inCi.join(" ")}\n` +
      `  declared: ${declared.join(" ")}\n` +
      `Adding a spec to the keyless release gate is a decision — make it in KEYLESS_SPECS and ` +
      `mirror it in the workflow step in the same change.`,
  );
});

test("the canonical guidance names the same keyless subset", () => {
  const declared = declaredSpecs();
  const guidance = read(".claude/CLAUDE.md");
  const line = guidance.match(/deterministic keyless subset =([^\n]*(?:\n\s*#[^\n]*)*)/);
  assert.ok(line, ".claude/CLAUDE.md must still describe the deterministic keyless subset");
  for (const spec of declared) {
    assert.ok(
      line[1].includes(spec),
      `.claude/CLAUDE.md's keyless-subset line omits "${spec}".\n` +
        `It is derived from KEYLESS_SPECS in playwright.config.ts — restate the whole list there ` +
        `when the list changes. Current line:\n  ${line[1].trim()}`,
    );
  }
  // …and nothing extra. A spec named in the guidance that the gate does not run
  // is exactly the drift that was already shipped (app-master-hire). Only the
  // ITEM HEADS count — a filter is what follows the leading `+` of a list item,
  // or the first name after `subset =`; the parenthetical prose after it
  // describes the spec and is not a claim about the gate's contents.
  const heads = [
    ...line[1].matchAll(/^\s*#\s*\+?\s*([a-z][a-z0-9.-]*)(?:\s+\+\s+([a-z][a-z0-9.-]*))?\s*(?:\(|$)/gm),
  ].flatMap((m) => [m[1], m[2]].filter(Boolean));
  assert.ok(heads.length >= declared.length, `parsed ${heads.length} item heads — the parse is broken`);
  for (const named of heads) {
    assert.ok(
      declared.includes(named),
      `.claude/CLAUDE.md's keyless-subset line names "${named}" as a member of the subset, but it ` +
        `is not in KEYLESS_SPECS. Either the gate should run it, or the guidance should stop ` +
        `claiming it does.`,
    );
  }
});
