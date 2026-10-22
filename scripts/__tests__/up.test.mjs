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

const { parseTunnelUrl, publicPasswordPlan, passwordProblem, passwordFromEnvFile, operatorPasswordFromEnv, NEXT_DEV_ENV_FILES } = await import("../tunnel.mjs");

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
  assert.deepEqual(parseArgs([]), { demo: false, check: false, open: true, help: false, public: false, unknown: [] });
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

test("--public is a flag and plain `up` stays unchanged", () => {
  assert.equal(parseArgs(["--public"]).public, true);
  assert.equal(parseArgs([]).public, false);
  const plain = serverEnv({}, { demo: false, python: "python" });
  assert.equal(plain.APP_BASE_URL, undefined);
  assert.equal(plain.NEXT_PUBLIC_APP_BASE_URL, undefined);
  const pub = serverEnv({}, { demo: false, python: "python", publicUrl: "https://a-b.trycloudflare.com" });
  assert.equal(pub.APP_BASE_URL, "https://a-b.trycloudflare.com");
  assert.equal(pub.NEXT_PUBLIC_APP_BASE_URL, "https://a-b.trycloudflare.com");
});

test("--public refuses open mode without a terminal, asks with one, passes with a password", () => {
  const refused = publicPasswordPlan({}, { isTTY: false });
  assert.equal(refused.action, "refuse");
  assert.match(refused.message, /KP_OPERATOR_PASSWORD/);
  assert.equal(publicPasswordPlan({ KP_OPERATOR_PASSWORD: "" }, { isTTY: true }).action, "prompt");
  assert.equal(publicPasswordPlan({ KP_OPERATOR_PASSWORD: "x".repeat(12) }, { isTTY: false }).action, "have");
});

test("--public will not go online behind a weak password it found configured", () => {
  // A short KP_OPERATOR_PASSWORD in .env.local was waved through as "have": the studio went
  // on the internet behind "admin". The same floor as a typed one applies.
  const weak = publicPasswordPlan({ KP_OPERATOR_PASSWORD: "admin" }, { isTTY: false });
  assert.equal(weak.action, "refuse");
  assert.match(weak.message, /12 characters/);
  assert.equal(weak.message.includes("admin"), false, "the refusal never prints the password");
  const asked = publicPasswordPlan({ KP_OPERATOR_PASSWORD: "admin" }, { isTTY: true });
  assert.equal(asked.action, "prompt");
  assert.match(asked.message, /too short/);
  assert.equal(publicPasswordPlan({ KP_OPERATOR_PASSWORD: "   " }, { isTTY: false }).action, "refuse", "blank is open mode");
});

test("the launcher judges the password the app will actually use (Next's env-file order)", () => {
  // Next dev: process env, then .env.development.local, .env.local, .env.development, .env;
  // the FIRST that assigns the key wins, even with a blank value.
  assert.deepEqual(NEXT_DEV_ENV_FILES, [".env.development.local", ".env.local", ".env.development", ".env"]);
  const files = { ".env.local": "KP_OPERATOR_PASSWORD=short\n", ".env": "KP_OPERATOR_PASSWORD=a-strong-enough-password\n" };
  assert.equal(operatorPasswordFromEnv({}, (f) => files[f] ?? null), "short", ".env.local beats .env");
  const blank = { ".env.local": "KP_OPERATOR_PASSWORD=\n", ".env": "KP_OPERATOR_PASSWORD=long-long-long-pw\n" };
  assert.equal(operatorPasswordFromEnv({}, (f) => blank[f] ?? null), "", "a blank assignment blocks the files below it");
  assert.equal(operatorPasswordFromEnv({ KP_OPERATOR_PASSWORD: "from-the-shell" }, (f) => files[f] ?? null), "from-the-shell", "the process env beats every file");
  assert.equal(operatorPasswordFromEnv({}, () => null), "");
});

test("password rules and env-file lookup", () => {
  assert.ok(passwordProblem("short", "short"));
  assert.ok(passwordProblem("a-long-enough-pw", "a-long-enough-px"));
  assert.equal(passwordProblem("a-long-enough-pw", "a-long-enough-pw"), null);
  assert.equal(passwordFromEnvFile('A=1\nKP_OPERATOR_PASSWORD="s3cret-value"\n'), "s3cret-value");
  assert.equal(passwordFromEnvFile("KP_OPERATOR_PASSWORD=\n"), "");
  assert.equal(passwordFromEnvFile("# KP_OPERATOR_PASSWORD=x"), "");
});

test("parseTunnelUrl lifts the quick-tunnel address from cloudflared's stderr", () => {
  const stderr = [
    "2026-10-22T10:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
    "2026-10-22T10:00:03Z INF +--------------------------------------------------------------------------------------------+",
    "2026-10-22T10:00:03Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
    "2026-10-22T10:00:03Z INF |  https://Quiet-Fox-1234.trycloudflare.com                                                  |",
  ].join("\n");
  assert.equal(parseTunnelUrl(stderr), "https://quiet-fox-1234.trycloudflare.com");
  assert.equal(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com..."), null);
  assert.equal(parseTunnelUrl("https://api.trycloudflare.com/tunnel"), "https://api.trycloudflare.com");
});
