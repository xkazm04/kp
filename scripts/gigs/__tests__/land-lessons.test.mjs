// Fixtures for scripts/gigs/land-lessons.mjs - every case runs against a FIXTURE
// registry built in a temp directory (its own git repo, a mini recipes/index.json,
// two recipes with LESSONS.md, a stub scripts/check-recipes.mjs that goes red on
// demand). The real ai-registry checkout is never read or written here.
//
// Run: node --test scripts/gigs/__tests__/land-lessons.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_TOKEN_HEADER,
  CO_AUTHOR,
  main,
  manifestRegistryLocal,
  planLanding,
  renderBlock,
  resolveRegistryDir,
  scrubBullet,
} from "../land-lessons.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "land-lessons.mjs");

// The registry's own heading shape (ai-registry scripts/lib/skills-lane.mjs LESSON_HEAD_RE).
const LESSON_HEAD_RE = /^## \S[^\n]*? [-–—] \d{4}-\d{2}-\d{2} [-–—] \S/;

const VERIFY = "pre-send-deliverable-verification";
const DISCLOSE = "disclosed-proposal-writing";
const SEED_ONLY = "security-report-drafting";
const VERIFY_REL = `recipes/general_professional/client-engagements/${VERIFY}/LESSONS.md`;
const DISCLOSE_REL = `recipes/sales_marketing/proposals/${DISCLOSE}/LESSONS.md`;

const LESSONS_HEAD = (slug) =>
  [
    `# Lessons - ${slug}`,
    "",
    "Append-only. One block per run, newest last, in the lane format:",
    "",
    "```markdown",
    "## <version used> - <YYYY-MM-DD> - <project>",
    "- What the run taught, in bullets.",
    "```",
    "",
  ].join("\n");

// Fails always (STUB_CHECK=fail), or only once a kp block is present
// (STUB_CHECK=fail-after-write), else passes.
const STUB_CHECK = `import fs from "node:fs";
import path from "node:path";
const mode = process.env.STUB_CHECK || "pass";
if (mode === "fail") { console.error("stub gate: red"); process.exit(1); }
if (mode === "fail-after-write") {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const hit = walk("recipes").filter((f) => f.endsWith("LESSONS.md")).some((f) => /^## .* - kp$/m.test(fs.readFileSync(f, "utf8")));
  if (hit) { console.error("stub gate: red after write"); process.exit(1); }
}
console.log("stub gate: ok");
`;

const TEMP_DIRS = [];
after(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function makeRegistry({ verifyExtra = "", withStranger = false } = {}) {
  const dir = tempDir("kp-land-lessons-");
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write(
    "recipes/index.json",
    JSON.stringify(
      {
        meta: { lane: "recipes" },
        recipes: {
          [VERIFY]: { path: `recipes/general_professional/client-engagements/${VERIFY}`, version: "0.1.0" },
          [DISCLOSE]: { path: `recipes/sales_marketing/proposals/${DISCLOSE}`, version: "0.1.0" },
        },
      },
      null,
      1,
    ),
  );
  write(VERIFY_REL, LESSONS_HEAD(VERIFY) + verifyExtra);
  write(DISCLOSE_REL, LESSONS_HEAD(DISCLOSE));
  write(`recipes/general_professional/client-engagements/${VERIFY}/recipe.json`, "{}\n");
  write("scripts/check-recipes.mjs", STUB_CHECK);
  write("README.md", "fixture registry\n");
  git(dir, "init", "--quiet", "-b", "main");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "fixture");
  if (withStranger) {
    write("README.md", "fixture registry\nedited by another session\n");
    write("notes/stranger.md", "someone else's work\n");
    git(dir, "add", "--", "README.md", "notes/stranger.md");
  }
  return dir;
}

function lessonsFile(dir, lessons) {
  const f = path.join(tempDir("kp-land-input-"), "lessons.json");
  fs.writeFileSync(f, JSON.stringify({ lessons }));
  return f;
}

async function run(argv, env = {}) {
  const out = [];
  const errs = [];
  const code = await main(argv, {
    env: { ...process.env, AI_REGISTRY_DIR: "", STUB_CHECK: "pass", ...env },
    log: (m) => out.push(String(m)),
    err: (m) => errs.push(String(m)),
  });
  return { code, out: out.join("\n"), err: errs.join("\n") };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const headSha = (dir) => git(dir, "rev-parse", "HEAD").trim();
const headFiles = (dir) => git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split(/\r?\n/).filter(Boolean).sort();
const staged = (dir) => git(dir, "diff", "--cached", "--name-only").split(/\r?\n/).filter(Boolean).sort();

function lesson(id, slug, bullets, { version = "0.1.0", createdAt = "2026-09-24T10:00:00.000Z" } = {}) {
  return { id, outcomeId: `o-${id}`, recipe: { slug, version }, recipePath: null, arena: "freelance", verdict: "accepted", bullets, createdAt };
}

// ---------------------------------------------------------------------------

test("scrubBullet drops leaks, keeps ratios, and flattens dashes", () => {
  for (const [bullet, reason] of [
    ["see https://example.com/report for detail", "url"],
    ["the maintainer at www.example.org replied", "url"],
    ["asked on acme.io before sending", "url"],
    ["write to jane.doe@example.com first", "email"],
    ["ping @janedoe before merging", "handle"],
    ["the diff touched src/app/page.tsx", "path"],
    ["run it from C:\\work\\thing", "path"],
    ["config in ~/secrets was read", "path"],
    ["edit lib/config.json to switch", "path"],
    ["the absolute /etc/hosts entry", "path"],
    ["ticket 12345678 was the dupe", "long_number"],
  ]) {
    const r = scrubBullet(bullet);
    assert.equal(r.ok, false, bullet);
    assert.equal(r.reason, reason, bullet);
  }
  for (const keep of [
    "accepted: freelance work whose evidence included test, repro and whose checklist had 6/6 items ticked",
    "accepted at qualification score 72/100 (reward stated: yes; deadline headroom: 5 days)",
    "accepted with evidence at send time: test x2 (2 passed, 0 failed); gate x1 (1 passed, 0 failed)",
    "rejected with the AI-use disclosure ticked before sending",
    "feedback (scrubbed): clear and/or concise, reward paid in 123456 units",
  ]) {
    const r = scrubBullet(keep);
    assert.equal(r.ok, true, keep);
    assert.equal(r.text, keep);
  }
  assert.equal(scrubBullet("scope held \u2014 the client liked it \u2013 twice").text, "scope held - the client liked it - twice");
  assert.equal(scrubBullet("line one\nline two").text, "line one line two");
  assert.equal(scrubBullet("   ").ok, false);
  assert.equal(scrubBullet(42).ok, false);
});

test("registry dir: flag, then AI_REGISTRY_DIR, then manifest registry.local", () => {
  const root = tempDir("kp-land-root-");
  fs.mkdirSync(path.join(root, ".ai"));
  fs.writeFileSync(path.join(root, ".ai", "manifest.yaml"), "name: x\nregistry:\n  remote: github:x/y\n  local: ../reg-from-manifest\nknowledge:\n  local: ../not-this\n");
  assert.equal(manifestRegistryLocal(root), "../reg-from-manifest");
  assert.equal(resolveRegistryDir({ flag: "/abs/flag", env: { AI_REGISTRY_DIR: "/abs/env" }, repoRoot: root }), path.resolve("/abs/flag"));
  assert.equal(resolveRegistryDir({ env: { AI_REGISTRY_DIR: "/abs/env" }, repoRoot: root }), path.resolve("/abs/env"));
  assert.equal(resolveRegistryDir({ env: {}, repoRoot: root }), path.resolve(root, "../reg-from-manifest"));
});

test("appends one lane-format block per recipe+version+date and commits exactly those files", async () => {
  const dir = makeRegistry();
  const before = headSha(dir);
  const file = lessonsFile(dir, [
    lesson("l1", VERIFY, ["accepted: freelance work whose evidence included test and whose checklist had 6/6 items ticked", "accepted with evidence at send time: test x1 (1 passed, 0 failed)"]),
    lesson("l2", VERIFY, ["accepted: freelance work whose evidence included test and whose checklist had 6/6 items ticked", "a second run on the same day"]),
    lesson("l3", VERIFY, ["a later run at a newer version"], { version: "0.2.0", createdAt: "2026-09-25T08:00:00.000Z" }),
    lesson("l4", DISCLOSE, ["accepted with the AI-use disclosure ticked before sending"]),
  ]);
  const r = await run(["--registry", dir, "--from-file", file]);
  assert.equal(r.code, 0, r.err);

  const verify = read(dir, VERIFY_REL);
  assert.ok(verify.startsWith(LESSONS_HEAD(VERIFY).trimEnd()), "the original content is kept byte for byte");
  assert.ok(
    verify.endsWith(
      [
        "",
        "## 0.1.0 - 2026-09-24 - kp",
        "- accepted: freelance work whose evidence included test and whose checklist had 6/6 items ticked",
        "- accepted with evidence at send time: test x1 (1 passed, 0 failed)",
        "- a second run on the same day",
        "",
        "## 0.2.0 - 2026-09-25 - kp",
        "- a later run at a newer version",
        "",
      ].join("\n"),
    ),
    verify,
  );
  assert.equal(read(dir, DISCLOSE_REL), `${LESSONS_HEAD(DISCLOSE).trimEnd()}\n\n## 0.1.0 - 2026-09-24 - kp\n- accepted with the AI-use disclosure ticked before sending\n`);
  for (const h of verify.split("\n").filter((l) => l.startsWith("## ") && l.endsWith(" - kp"))) assert.match(h, LESSON_HEAD_RE);

  assert.notEqual(headSha(dir), before);
  assert.deepEqual(headFiles(dir), [VERIFY_REL, DISCLOSE_REL].sort());
  const msg = git(dir, "log", "-1", "--format=%B");
  assert.match(msg, /^chore\(recipes\): land 4 outcome lesson\(s\) from kp gigs/);
  assert.match(msg, new RegExp(`- ${VERIFY}@0\\.1\\.0: 3 bullet\\(s\\) from 2 lesson\\(s\\)`));
  assert.match(msg, new RegExp(`- ${VERIFY}@0\\.2\\.0: 1 bullet\\(s\\) from 1 lesson\\(s\\)`));
  assert.match(msg, new RegExp(`- ${DISCLOSE}@0\\.1\\.0: 1 bullet\\(s\\) from 1 lesson\\(s\\)`));
  assert.equal(msg.trim().split("\n").at(-1), CO_AUTHOR);
  assert.equal(git(dir, "status", "--porcelain"), "", "nothing left dirty");
  assert.match(r.out, /not marked in kp \(4 lesson\(s\)\); pass --mark/);
});

test("dedupes against the file: a bullet already present is not appended again", async () => {
  const existing = "\n## 0.1.0 - 2026-09-20 - kp\n- rejected as duplicate: check for prior reports before drafting\n";
  const dir = makeRegistry({ verifyExtra: existing });
  const before = headSha(dir);
  const original = read(dir, VERIFY_REL);

  // Every bullet already present: nothing is written or committed, and the lesson
  // still counts as landed (its content IS in the registry).
  const onlyOld = lessonsFile(dir, [lesson("d1", VERIFY, ["rejected as duplicate: check for prior reports before drafting"])]);
  const plan = planLanding([lesson("d1", VERIFY, ["rejected as duplicate: check for prior reports before drafting"])], dir);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.landedIds, ["d1"]);
  const r1 = await run(["--registry", dir, "--from-file", onlyOld]);
  assert.equal(r1.code, 0, r1.err);
  assert.equal(read(dir, VERIFY_REL), original);
  assert.equal(headSha(dir), before);

  // Mixed: only the new bullet goes, and a bullet repeated across lessons goes once.
  const mixed = lessonsFile(dir, [
    lesson("d2", VERIFY, ["rejected as duplicate: check for prior reports before drafting", "new insight"]),
    lesson("d3", VERIFY, ["new insight"]),
  ]);
  const r2 = await run(["--registry", dir, "--from-file", mixed]);
  assert.equal(r2.code, 0, r2.err);
  const after = read(dir, VERIFY_REL);
  assert.equal(after, `${original.trimEnd()}\n\n## 0.1.0 - 2026-09-24 - kp\n- new insight\n`);
  assert.equal(after.split("rejected as duplicate").length, 2, "the old bullet appears exactly once");
});

test("skips a seed-only slug (not in the index) and never counts it landed", async () => {
  const dir = makeRegistry();
  const lessons = [lesson("s1", SEED_ONLY, ["something learned"]), lesson("s2", DISCLOSE, ["disclosure lesson"])];
  const plan = planLanding(lessons, dir);
  assert.deepEqual(plan.skipped, [{ id: "s1", slug: SEED_ONLY, reason: "not_in_registry" }]);
  assert.deepEqual(plan.landedIds, ["s2"]);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, lessons)]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /skip s1 \(security-report-drafting\): not_in_registry/);
  assert.deepEqual(headFiles(dir), [DISCLOSE_REL]);
  assert.ok(!fs.existsSync(path.join(dir, "recipes", SEED_ONLY)), "no directory is ever built from a slug");
});

test("scrubs: a leaking bullet is dropped, dashes are flattened, a fully-scrubbed lesson stays pending", async () => {
  const dir = makeRegistry();
  const lessons = [
    lesson("c1", VERIFY, ["feedback (scrubbed): see https://evil.example/x", "feedback (scrubbed): tight scope \u2014 good tests", "mail ops@example.com"]),
    lesson("c2", DISCLOSE, ["patched lib/secret/file.ts", "call @someone"]),
  ];
  const plan = planLanding(lessons, dir);
  assert.deepEqual(plan.landedIds, ["c1"]);
  assert.deepEqual(plan.skipped, [{ id: "c2", slug: DISCLOSE, reason: "nothing_landable" }]);
  assert.deepEqual(plan.dropped.map((d) => d.reason).sort(), ["email", "handle", "path", "url"]);
  assert.equal(renderBlock(plan.groups[0]), "## 0.1.0 - 2026-09-24 - kp\n- feedback (scrubbed): tight scope - good tests");

  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, lessons)]);
  assert.equal(r.code, 0, r.err);
  const text = read(dir, VERIFY_REL);
  assert.ok(!/https?:|@|\u2014|\u2013/.test(text.slice(LESSONS_HEAD(VERIFY).length)));
  assert.equal(read(dir, DISCLOSE_REL), LESSONS_HEAD(DISCLOSE));
});

test("rollback: a gate that goes red after writing restores the exact bytes and exits 1", async () => {
  const dir = makeRegistry({ verifyExtra: "\n## 0.1.0 - 2026-09-01 - personas\n- an older lesson\n" });
  const before = headSha(dir);
  const origVerify = read(dir, VERIFY_REL);
  const origDisclose = read(dir, DISCLOSE_REL);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, [lesson("r1", VERIFY, ["x lesson"]), lesson("r2", DISCLOSE, ["y lesson"])])], {
    STUB_CHECK: "fail-after-write",
  });
  assert.equal(r.code, 1);
  assert.match(r.err, /failed after writing - restored 2 file\(s\)/);
  assert.equal(read(dir, VERIFY_REL), origVerify);
  assert.equal(read(dir, DISCLOSE_REL), origDisclose);
  assert.equal(headSha(dir), before);
  assert.equal(git(dir, "status", "--porcelain"), "");
});

test("a registry that is already red is not landed on", async () => {
  const dir = makeRegistry();
  const orig = read(dir, VERIFY_REL);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, [lesson("p1", VERIFY, ["x lesson"])])], { STUB_CHECK: "fail" });
  assert.equal(r.code, 1);
  assert.match(r.err, /red BEFORE landing/);
  assert.equal(read(dir, VERIFY_REL), orig);
});

test("a pre-staged stranger stays staged and out of the commit", async () => {
  const dir = makeRegistry({ withStranger: true });
  assert.deepEqual(staged(dir), ["README.md", "notes/stranger.md"]);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, [lesson("t1", VERIFY, ["stranger-safe lesson"])])]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(headFiles(dir), [VERIFY_REL], "the commit carries only the LESSONS.md written");
  assert.deepEqual(staged(dir), ["README.md", "notes/stranger.md"], "the stranger's staging is untouched");
  assert.equal(read(dir, "README.md"), "fixture registry\nedited by another session\n");
  assert.match(r.out, /left staged and uncommitted \(not ours\): README\.md, notes\/stranger\.md/);
});

test("a LESSONS.md with someone else's uncommitted edit is skipped, not mixed into our commit", async () => {
  const dir = makeRegistry();
  fs.appendFileSync(path.join(dir, VERIFY_REL), "\n## 0.1.0 - 2026-09-23 - other\n- in flight\n");
  const plan = planLanding([lesson("u1", VERIFY, ["x lesson"])], dir);
  assert.deepEqual(plan.skipped, [{ id: "u1", slug: VERIFY, reason: "uncommitted_changes" }]);
  assert.deepEqual(plan.landedIds, []);
});

test("--dry-run prints the blocks and touches nothing", async () => {
  const dir = makeRegistry();
  const before = headSha(dir);
  const orig = read(dir, VERIFY_REL);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, [lesson("y1", VERIFY, ["dry lesson"])]), "--dry-run"], { STUB_CHECK: "fail" });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`would append to ${VERIFY_REL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
  assert.match(r.out, /## 0\.1\.0 - 2026-09-24 - kp\n- dry lesson/);
  assert.equal(read(dir, VERIFY_REL), orig);
  assert.equal(headSha(dir), before);
  assert.equal(git(dir, "status", "--porcelain"), "");
});

test("--no-commit writes and verifies but leaves the commit to a human", async () => {
  const dir = makeRegistry();
  const before = headSha(dir);
  const r = await run(["--registry", dir, "--from-file", lessonsFile(dir, [lesson("n1", VERIFY, ["uncommitted lesson"])]), "--no-commit"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(headSha(dir), before);
  assert.match(read(dir, VERIFY_REL), /- uncommitted lesson\n$/);
  assert.equal(git(dir, "status", "--porcelain").trim(), `M ${VERIFY_REL}`);
});

test("network mode: GET through the automation door, POST exactly the landed ids", async () => {
  const dir = makeRegistry();
  const seen = { get: null, post: null, tokens: [] };
  const lessons = [lesson("w1", VERIFY, ["network lesson"]), lesson("w2", SEED_ONLY, ["seed lesson"])];
  const server = http.createServer((req, res) => {
    seen.tokens.push(req.headers[AUTOMATION_TOKEN_HEADER]);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET") {
        seen.get = req.url;
        res.end(JSON.stringify({ lessons }));
      } else {
        seen.post = JSON.parse(body);
        res.end(JSON.stringify({ landed: seen.post.ids.length }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = "t".repeat(32);
    const r = await run(["--registry", dir, "--base-url", base, "--workspace", "ws-1"], { KP_AUTOMATION_TOKEN: token });
    assert.equal(r.code, 0, r.err);
    assert.equal(seen.get, "/api/gigs/lessons?pending=1&workspace=ws-1");
    assert.deepEqual(seen.post, { ids: ["w1"], workspace: "ws-1" });
    assert.deepEqual(seen.tokens, [token, token]);
    assert.match(r.out, /marked 1 of 1 lesson\(s\) landed in kp/);
    assert.deepEqual(headFiles(dir), [VERIFY_REL]);

    // Without the token the machine door cannot be used - say so, touch nothing.
    const r2 = await run(["--registry", dir, "--base-url", base], { KP_AUTOMATION_TOKEN: "" });
    assert.equal(r2.code, 2);
    assert.match(r2.err, /KP_AUTOMATION_TOKEN is unset/);
  } finally {
    server.close();
  }
});

test("the CLI entry point runs and exits with main's code", () => {
  const dir = makeRegistry();
  const res = spawnSync(process.execPath, [SCRIPT, "--registry", dir, "--from-file", lessonsFile(dir, [lesson("e1", VERIFY, ["cli lesson"])]), "--dry-run"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /- cli lesson/);
  const bad = spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
