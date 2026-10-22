// Fixtures for scripts/up.mjs — the one-command start a non-technical owner runs.
// Only the pure parts are pinned here: what counts as Node 24, which flags exist,
// how requirements.txt pins are read and compared, how the address is lifted out of
// Next's banner, and which environment each mode hands the dev server (the owner
// mode must be the unseeded, persistent workspace; --demo must be plain `npm run dev`).
//
// Run: npm run test:docs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { nodeMajor, parseArgs, parseRequirements, compareInstalled, extractLocalUrl, serverEnv, staleNodeDeps } = await import(
  "../up.mjs"
);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("nodeMajor reads process.version shapes", () => {
  assert.equal(nodeMajor("v24.14.0"), 24);
  assert.equal(nodeMajor("20.11.1"), 20);
  assert.equal(nodeMajor(""), null);
  assert.equal(nodeMajor("garbage"), null);
});

test("the launcher's Node major is the one package.json engines admits", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const src = readFileSync(path.join(REPO_ROOT, "scripts", "up.mjs"), "utf8");
  const declared = Number(/const NODE_MAJOR = (\d+);/.exec(src)?.[1]);
  assert.match(pkg.engines.node, new RegExp(`^>=${declared}\\.0\\.0 <${declared + 1}\\.0\\.0$`));
  assert.equal(pkg.scripts.up, "node scripts/up.mjs");
});

test("parseArgs knows its four flags and reports anything else", () => {
  assert.deepEqual(parseArgs([]), { demo: false, check: false, open: true, help: false, unknown: [] });
  const all = parseArgs(["--demo", "--check", "--no-open", "-h"]);
  assert.equal(all.demo && all.check && !all.open && all.help, true);
  assert.deepEqual(parseArgs(["--dmeo"]).unknown, ["--dmeo"]);
});

test("parseRequirements reads name==version pins and skips comments", () => {
  const text = "# header\npypdf==6.20.1\r\n\n  google-genai==2.31.0  # inline\nnot-a-pin>=1\n";
  assert.deepEqual(parseRequirements(text), [
    { name: "pypdf", version: "6.20.1" },
    { name: "google-genai", version: "2.31.0" },
  ]);
  // The real file parses to at least the packages the pipeline cannot start without.
  const real = parseRequirements(readFileSync(path.join(REPO_ROOT, "requirements.txt"), "utf8")).map((p) => p.name);
  for (const name of ["pydantic", "pypdf"]) assert.ok(real.includes(name), `${name} missing from the parse`);
});

test("compareInstalled separates missing from version drift", () => {
  const pins = [
    { name: "a", version: "1.0" },
    { name: "b", version: "2.0" },
    { name: "c", version: "3.0" },
  ];
  assert.deepEqual(compareInstalled(pins, { a: "1.0", b: "2.1", c: null }), {
    missing: ["c"],
    mismatched: ["b 2.1 (wants 2.0)"],
  });
  // An unreadable probe answer means everything is treated as missing.
  assert.deepEqual(compareInstalled(pins, null).missing, ["a", "b", "c"]);
});

test("extractLocalUrl lifts the address from both of Next's banners", () => {
  assert.equal(extractLocalUrl("   - Local:        http://localhost:3000"), "http://localhost:3000");
  assert.equal(extractLocalUrl("- Local:        http://localhost:3001/"), "http://localhost:3001");
  assert.equal(extractLocalUrl("compiled / in 2.1s"), null);
});

test("owner mode is the unseeded persistent workspace; --demo is plain npm run dev", () => {
  const owner = serverEnv({ PATH: "x" }, { demo: false, python: "python" });
  assert.equal(owner.KP_EMPTY, "1");
  assert.equal(owner.KP_DB_PATH, path.join("data", "kp-owner.sqlite"));
  assert.equal(owner.KP_PYTHON, "python");
  assert.equal(owner.DEV_GUARD_MAX_NODE, "150");

  const demo = serverEnv({}, { demo: true, python: "python" });
  assert.equal(demo.KP_EMPTY, undefined);
  assert.equal(demo.KP_DB_PATH, undefined);

  // An explicit choice in the shell wins.
  const named = serverEnv({ KP_DB_PATH: "/srv/kp.sqlite", PYTHON_CMD: "/opt/py" }, { demo: false, python: "python" });
  assert.equal(named.KP_DB_PATH, "/srv/kp.sqlite");
  assert.equal(named.KP_PYTHON, undefined);
});

test("staleNodeDeps flags exact pins that are missing or drifted, and leaves ranges alone", () => {
  const pkg = {
    dependencies: { next: "16.4.2", react: "^19.0.0", zod: "4.1.0" },
    devDependencies: { tsx: "4.20.0-beta.1" },
  };
  const installed = { next: "16.3.8", react: "19.2.0", zod: "4.1.0", tsx: null };
  assert.deepEqual(staleNodeDeps(pkg, (n) => installed[n] ?? null), [
    "next 16.3.8 (wants 16.4.2)",
    "tsx missing (wants 4.20.0-beta.1)",
  ]);
  assert.deepEqual(staleNodeDeps({}, () => null), []);
});
