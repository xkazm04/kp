// TOOLCHAIN PIN — package.json must declare the Node line CI actually installs.
//
// WHAT THIS EXISTS TO CATCH. `package.json` declared no `engines` at all while
// twelve workflow steps across seven workflows pinned `node-version: 24`. The
// runtime the project requires was therefore stated ONLY inside CI: a
// contributor on Node 20 got a syntax error from `--experimental-transform-types`
// (the whole unit-test runner) with nothing anywhere saying which version was
// expected, and `npm install` printed no warning because there was no range to
// warn against. The reverse drift is worse and quieter: bumping the workflows to
// the next LTS leaves `engines` behind, and the field that contributors and
// Dockerfiles read starts lying.
//
// So the pin is bidirectional and derived from the real files — no third list to
// keep in step. Every `node-version:` in .github/workflows/ must agree on one
// major, and `engines.node` must be the range that admits exactly that major.
//
// Runner: plain node:test, no deps — `npm run test:docs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

/** Every `node-version: <x>` in the workflow tree, with the file it came from. */
function workflowNodeVersions() {
  const out = [];
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const src = readFileSync(path.join(WORKFLOW_DIR, name), "utf8");
    for (const m of src.matchAll(/^\s*node-version:\s*['"]?([0-9][0-9.x]*)['"]?/gm)) {
      out.push({ file: name, version: m[1] });
    }
  }
  return out;
}

test("every workflow installs the same Node major", () => {
  const pins = workflowNodeVersions();
  // Non-vacuity: if the scan finds nothing, this file is asserting about an
  // empty set and would pass through any regression at all.
  assert.ok(pins.length >= 10, `expected to find the workflow node pins, found ${pins.length}`);
  const majors = [...new Set(pins.map((p) => p.version.split(".")[0]))];
  assert.deepEqual(
    majors,
    [majors[0]],
    `Workflows disagree on the Node major:\n  ` +
      pins.map((p) => `${p.file}: ${p.version}`).join("\n  ") +
      `\nPick one and change them together — package.json engines.node follows this number.`,
  );
});

test("package.json engines.node admits exactly the major CI installs", () => {
  const major = workflowNodeVersions()[0].version.split(".")[0];
  const declared = pkg.engines?.node;
  assert.ok(
    declared,
    `package.json declares no engines.node, but .github/workflows pins node-version: ${major}. ` +
      `Add "engines": { "node": ">=${major}.0.0 <${Number(major) + 1}.0.0" } so the requirement is ` +
      `stated where contributors, npm and the Dockerfile read it — not only inside CI.`,
  );
  assert.equal(
    declared,
    `>=${major}.0.0 <${Number(major) + 1}.0.0`,
    `engines.node (${declared}) and the workflows' node-version: ${major} have drifted. ` +
      `Whichever moved, move the other in the same change.`,
  );
});

test("packageManager pins an exact npm build", () => {
  const declared = pkg.packageManager;
  assert.ok(declared, "package.json must declare packageManager so corepack resolves one npm for everyone");
  assert.match(
    declared,
    /^npm@\d+\.\d+\.\d+$/,
    `packageManager must be an EXACT npm version (got ${declared}). A range defeats the point: ` +
      `the field exists so every checkout and every CI runner resolves the same npm, and this ` +
      `repo's .npmrc legacy-peer-deps behaviour is npm-version sensitive.`,
  );
});

test("npm run dev arms the storm breaker at 150", () => {
  // The breaker is opt-in inside scripts/dev-guard.mjs (unset = off) so other
  // wrappers are unchanged. The everyday `dev` script must still set the same
  // 150 that `dev:inspect` / `dev:empty` already do — Turbopack still spawns
  // loader workers on a normal next dev, and Windows still does not cascade kill.
  const dev = pkg.scripts?.dev;
  assert.ok(dev, "package.json must declare a dev script");
  assert.match(
    dev,
    /DEV_GUARD_MAX_NODE=150/,
    `npm run dev must set DEV_GUARD_MAX_NODE=150 so a worker storm is reaped on the everyday server, not only on inspect (got ${dev}).`,
  );
  assert.match(dev, /dev-guard\.mjs/, "the everyday dev script must still go through the process-tree reaper");
});
