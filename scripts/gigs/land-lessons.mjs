#!/usr/bin/env node
/**
 * land-lessons - carry kp's Gigs outcome lessons into the registry's recipe
 * LESSONS.md files, and commit them there without a human review.
 *
 * WHY NO REVIEW, AND WHY ONLY LESSONS.md. The registry's recipes lane
 * (ai-registry docs/recipes-lane.md) splits a recipe in two: LESSONS.md records a
 * run against a version and needs no version bump; every other file in the
 * recipe directory is the METHOD and is review-gated. A lesson derived from a
 * real external verdict is exactly "a run against a version", so it may land as
 * a direct commit - and this script can write nothing else. It never creates a
 * file, never touches recipe.json / RECIPE.md / examples, never pushes.
 *
 * Flow:
 *   1. lessons in: GET {KP_BASE_URL}/api/gigs/lessons?pending=1 through the
 *      automation door (header x-kp-automation-token = KP_AUTOMATION_TOKEN, the
 *      same door POST /api/agents/hire-from-need uses), or --from-file <json>.
 *   2. registry: --registry <dir>, else AI_REGISTRY_DIR, else .ai/manifest.yaml
 *      registry.local resolved from the kp repo root (default ../ai-registry).
 *   3. per lesson: the recipe dir comes from recipes/index.json by slug (a path
 *      is never built from a slug). A slug the index lacks is skipped as
 *      `not_in_registry` and stays pending in kp.
 *   4. every bullet is re-scrubbed (defense in depth - kp scrubbed it once):
 *      a bullet with a URL, an e-mail, an @handle, a path-like token or a digit
 *      run longer than six is DROPPED; em/en dashes become a plain hyphen.
 *      A bullet already present verbatim in the file is not appended again.
 *   5. one block per recipe + version + date, in the lane format:
 *        ## <version used> - <YYYY-MM-DD> - kp
 *        - <bullet>
 *   6. the registry gate (node scripts/check-recipes.mjs) runs BEFORE writing
 *      (a red registry is not ours to land on) and AFTER; a red after-run
 *      restores the exact bytes read before writing and exits 1.
 *   7. commit ONLY the LESSONS.md files written. Anything another session had
 *      staged stays staged and out of this commit (git commit --only).
 *   8. POST /api/gigs/lessons {ids} for exactly the lessons that landed.
 *
 * Usage:
 *   node scripts/gigs/land-lessons.mjs [--registry <dir>] [--from-file <json>]
 *        [--base-url <url>] [--workspace <id>] [--dry-run] [--no-commit] [--mark]
 *
 * Exit: 0 landed (or nothing to land), 1 refused/rolled back/commit or mark
 * failed, 2 usage or unreadable input. Node builtins only.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT = "kp";
export const AUTOMATION_TOKEN_ENV = "KP_AUTOMATION_TOKEN";
export const AUTOMATION_TOKEN_HEADER = "x-kp-automation-token";
export const MAX_IDS_PER_POST = 500;
export const CO_AUTHOR = "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>";

const KP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Arguments and registry resolution
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { registry: null, fromFile: null, baseUrl: null, workspace: null, dryRun: false, noCommit: false, mark: false, help: false };
  const takes = { "--registry": "registry", "--from-file": "fromFile", "--base-url": "baseUrl", "--workspace": "workspace" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in takes) {
      const v = argv[i + 1];
      if (typeof v !== "string" || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[takes[a]] = v;
      i++;
    } else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-commit") out.noCommit = true;
    else if (a === "--mark") out.mark = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** `registry.local` from .ai/manifest.yaml by line scan (same reader as
 *  app/_lib/gigs/recipes.ts manifestRegistryLocal). */
export function manifestRegistryLocal(repoRoot) {
  let text;
  try {
    text = fs.readFileSync(path.join(repoRoot, ".ai", "manifest.yaml"), "utf8");
  } catch {
    // No manifest: the caller falls back to the documented default path.
    return null;
  }
  let inRegistry = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\S/.test(raw)) inRegistry = /^registry:\s*(#.*)?$/.test(raw);
    else if (inRegistry) {
      const m = /^\s+local:\s*["']?([^"'#\s][^"'#]*?)["']?\s*(#.*)?$/.exec(raw);
      if (m) return m[1].trim();
    }
  }
  return null;
}

export function resolveRegistryDir({ flag, env = process.env, repoRoot = KP_ROOT } = {}) {
  const configured = (flag && flag.trim()) || env.AI_REGISTRY_DIR?.trim() || manifestRegistryLocal(repoRoot) || "../ai-registry";
  return path.resolve(repoRoot, configured);
}

// ---------------------------------------------------------------------------
// Scrubbing (defense in depth; kp's lessons.ts scrubbed the feedback once)
// ---------------------------------------------------------------------------

/** A bullet containing any of these is dropped whole - rewriting around a leak
 *  risks leaving half of it. Ordered for the reason string. */
const LEAK_PATTERNS = [
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/],
  ["url", /\b(?:https?|ftp|file):\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|cz|de|fr|uk|eu|gov|edu|info|biz)\b/i],
  ["handle", /(?:^|[^\w@])@[A-Za-z0-9_]/],
  // Path-like: a drive letter, a home or dot-relative prefix, an absolute path, any
  // backslash between names, two or more slash separators, or name/file.ext. A single
  // slash between numbers or words ("3/6 items", "72/100", "and/or") is not a path.
  ["path", /\b[A-Za-z]:[\\/]|(?:^|[\s("'`])(?:~|\.{1,2})[\\/]|(?:^|[\s("'`=:])\/[\w.-]|[\w.-]\\[\w.-]|[\w.-]+\/[\w.-]+\/[\w.-]+|[\w-]+\/[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b/],
  ["long_number", /\d{7,}/],
];

/** One bullet made fit for LESSONS.md, or a reason it cannot go. */
export function scrubBullet(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "not_text" };
  let text = raw.normalize("NFKC").replace(/[\r\n\t]+/g, " ");
  // The lane forbids em/en dashes in recipe.json; LESSONS.md stays as clean.
  text = text.replace(/\s*[‒-―−]\s*/g, " - ");
  text = text.replace(/\s{2,}/g, " ").trim().replace(/^[-*]\s+/, "");
  if (!text) return { ok: false, reason: "empty" };
  for (const [reason, re] of LEAK_PATTERNS) if (re.test(text)) return { ok: false, reason };
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function readIndex(registryDir) {
  const file = path.join(registryDir, "recipes", "index.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed.recipes !== "object" || parsed.recipes === null) throw new Error(`${file} carries no "recipes" object`);
  return parsed.recipes;
}

/** The recipe's LESSONS.md, resolved THROUGH the index; null when the index path is
 *  missing or escapes recipes/. */
function lessonsFileFor(registryDir, entry) {
  const rel = typeof entry?.path === "string" ? entry.path : null;
  if (!rel) return null;
  const lane = path.resolve(registryDir, "recipes");
  const dir = path.resolve(registryDir, rel);
  if (!dir.startsWith(lane + path.sep)) return null;
  return path.join(dir, "LESSONS.md");
}

function existingBullets(content) {
  const set = new Set();
  for (const line of content.split(/\r?\n/)) {
    const m = /^- (.*)$/.exec(line);
    if (m) set.add(m[1].trim());
  }
  return set;
}

function lessonDate(createdAt, now) {
  if (typeof createdAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(createdAt)) return createdAt.slice(0, 10);
  const t = typeof createdAt === "number" ? new Date(createdAt) : null;
  return (t && !Number.isNaN(t.getTime()) ? t : now).toISOString().slice(0, 10);
}

function gitDirty(registryDir, rel) {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", rel], { cwd: registryDir, encoding: "utf8" }).trim() !== "";
  } catch {
    // Not a git checkout: nothing can be dirty against a commit that does not exist.
    return false;
  }
}

/**
 * Decide what lands where. Reads, never writes.
 * Returns { groups, skipped, landedIds } where each group is one block for one
 * LESSONS.md, `skipped` names every lesson that will NOT be marked and why, and
 * `landedIds` is every lesson whose content will be in the registry afterwards
 * (written now, or already present verbatim from an earlier run).
 */
export function planLanding(lessons, registryDir, { now = new Date(), checkDirty = true } = {}) {
  const index = readIndex(registryDir);
  const skipped = [];
  const dropped = [];
  const files = new Map(); // abs -> { rel, original, seen:Set }
  const groups = new Map(); // key -> group
  const lessonState = new Map(); // id -> { appended:number, present:number }

  for (const lesson of lessons) {
    const id = typeof lesson?.id === "string" ? lesson.id : null;
    const slug = lesson?.recipe?.slug;
    const version = lesson?.recipe?.version;
    if (!id) {
      skipped.push({ id: null, slug: slug ?? null, reason: "invalid_lesson" });
      continue;
    }
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      skipped.push({ id, slug: slug ?? null, reason: "invalid_slug" });
      continue;
    }
    if (typeof version !== "string" || !VERSION_RE.test(version)) {
      skipped.push({ id, slug, reason: "invalid_version" });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(index, slug)) {
      skipped.push({ id, slug, reason: "not_in_registry" });
      continue;
    }
    const abs = lessonsFileFor(registryDir, index[slug]);
    if (!abs) {
      skipped.push({ id, slug, reason: "index_path_invalid" });
      continue;
    }
    let file = files.get(abs);
    if (!file) {
      if (!fs.existsSync(abs)) {
        skipped.push({ id, slug, reason: "lessons_file_missing" });
        continue;
      }
      const rel = path.relative(registryDir, abs).split(path.sep).join("/");
      if (checkDirty && gitDirty(registryDir, rel)) {
        skipped.push({ id, slug, reason: "uncommitted_changes" });
        continue;
      }
      const original = fs.readFileSync(abs, "utf8");
      file = { abs, rel, original, seen: existingBullets(original) };
      files.set(abs, file);
    }

    const bullets = Array.isArray(lesson.bullets) ? lesson.bullets : [];
    const state = { appended: 0, present: 0 };
    const date = lessonDate(lesson.createdAt, now);
    const key = `${abs}\n${version}\n${date}`;
    for (const raw of bullets) {
      const s = scrubBullet(raw);
      if (!s.ok) {
        dropped.push({ id, slug, reason: s.reason });
        continue;
      }
      if (file.seen.has(s.text)) {
        state.present += 1;
        continue;
      }
      file.seen.add(s.text);
      let group = groups.get(key);
      if (!group) {
        group = { slug, version, date, file: file.abs, rel: file.rel, bullets: [], lessonIds: [] };
        groups.set(key, group);
      }
      group.bullets.push(s.text);
      if (!group.lessonIds.includes(id)) group.lessonIds.push(id);
      state.appended += 1;
    }
    lessonState.set(id, state);
    if (state.appended === 0 && state.present === 0) skipped.push({ id, slug, reason: "nothing_landable" });
  }

  const landedIds = [...lessonState.entries()].filter(([, s]) => s.appended + s.present > 0).map(([id]) => id);
  return { groups: [...groups.values()], skipped, dropped, landedIds, files: [...files.values()] };
}

export function renderBlock(group) {
  return [`## ${group.version} - ${group.date} - ${PROJECT}`, ...group.bullets.map((b) => `- ${b}`)].join("\n");
}

/** The new file content: the original, then each block, one blank line apart,
 *  in the file's own line endings. */
export function appendBlocks(original, blocks) {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let out = original.replace(/\s+$/, "");
  for (const b of blocks) out += `${eol}${eol}${b.split("\n").join(eol)}`;
  return `${out}${eol}`;
}

// ---------------------------------------------------------------------------
// Registry side effects
// ---------------------------------------------------------------------------

export function runRegistryCheck(registryDir, env = process.env) {
  const r = spawnSync(process.execPath, ["scripts/check-recipes.mjs"], { cwd: registryDir, encoding: "utf8", env });
  return { ok: r.status === 0, status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function git(registryDir, args) {
  return execFileSync("git", args, { cwd: registryDir, encoding: "utf8" });
}

export function commitMessage(groups) {
  const perRecipe = new Map();
  for (const g of groups) {
    const k = `${g.slug}@${g.version}`;
    const acc = perRecipe.get(k) ?? { bullets: 0, lessons: new Set() };
    acc.bullets += g.bullets.length;
    for (const id of g.lessonIds) acc.lessons.add(id);
    perRecipe.set(k, acc);
  }
  const n = new Set(groups.flatMap((g) => g.lessonIds)).size;
  const body = [...perRecipe.entries()].map(([k, a]) => `- ${k}: ${a.bullets} bullet(s) from ${a.lessons.size} lesson(s)`);
  return [
    `chore(recipes): land ${n} outcome lesson(s) from kp gigs`,
    "",
    "Appended by kp scripts/gigs/land-lessons.mjs. LESSONS.md only: a lesson records a run",
    "against a version and needs no version bump (docs/recipes-lane.md).",
    "",
    ...body,
    "",
    CO_AUTHOR,
  ].join("\n");
}

/**
 * Commit exactly `rels`. They are staged, the staged set is read back, and when
 * another session has pre-staged files the commit is made with `--only`, which
 * records just our paths and leaves the stranger's index entries as they were -
 * nothing of theirs is unstaged, stashed or reverted. HEAD is read back after.
 */
export function commitOnly(registryDir, rels, message) {
  git(registryDir, ["add", "--", ...rels]);
  const staged = git(registryDir, ["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
  const ours = new Set(rels);
  const missing = rels.filter((r) => !staged.includes(r));
  if (missing.length > 0) throw new Error(`nothing staged for ${missing.join(", ")}`);
  const strangers = staged.filter((s) => !ours.has(s));
  const msgFile = path.join(registryDir, ".git", "KP_LAND_LESSONS_MSG");
  fs.writeFileSync(msgFile, `${message}\n`);
  try {
    git(registryDir, ["commit", "--quiet", "--only", "-F", msgFile, "--", ...rels]);
  } finally {
    fs.rmSync(msgFile, { force: true });
  }
  const committed = git(registryDir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split(/\r?\n/).filter(Boolean);
  const same = committed.length === rels.length && committed.every((c) => ours.has(c));
  if (!same) throw new Error(`HEAD carries ${committed.join(", ")} - expected exactly ${rels.join(", ")}`);
  return { sha: git(registryDir, ["rev-parse", "HEAD"]).trim(), strangers };
}

// ---------------------------------------------------------------------------
// kp side
// ---------------------------------------------------------------------------

function kpHeaders(env) {
  const token = env[AUTOMATION_TOKEN_ENV]?.trim();
  if (!token) throw new Error(`${AUTOMATION_TOKEN_ENV} is unset - the lessons route's machine door needs it`);
  return { [AUTOMATION_TOKEN_HEADER]: token, "content-type": "application/json" };
}

export async function fetchPending(baseUrl, workspace, env = process.env) {
  const u = new URL("/api/gigs/lessons", baseUrl);
  u.searchParams.set("pending", "1");
  if (workspace) u.searchParams.set("workspace", workspace);
  const res = await fetch(u, { headers: kpHeaders(env) });
  if (!res.ok) throw new Error(`GET ${u.pathname} answered ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.lessons)) throw new Error(`GET ${u.pathname} carried no lessons array`);
  return body.lessons;
}

export async function markLanded(baseUrl, workspace, ids, env = process.env) {
  let landed = 0;
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_POST) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_POST);
    const res = await fetch(new URL("/api/gigs/lessons", baseUrl), {
      method: "POST",
      headers: kpHeaders(env),
      body: JSON.stringify(workspace ? { ids: chunk, workspace } : { ids: chunk }),
    });
    if (!res.ok) throw new Error(`POST /api/gigs/lessons answered ${res.status}`);
    const body = await res.json().catch(() => ({}));
    landed += typeof body?.landed === "number" ? body.landed : 0;
  }
  return landed;
}

function readLessonsFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const lessons = Array.isArray(parsed) ? parsed : parsed?.lessons;
  if (!Array.isArray(lessons)) throw new Error(`${file}: expected an array or { lessons: [...] }`);
  return lessons;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const HELP = `usage: node scripts/gigs/land-lessons.mjs [--registry <dir>] [--from-file <json>]
       [--base-url <url>] [--workspace <id>] [--dry-run] [--no-commit] [--mark]`;

export async function main(argv, { env = process.env, log = console.log, err = console.error } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`land-lessons: ${e.message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    log(HELP);
    return 0;
  }
  const baseUrl = (args.baseUrl || env.KP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const registryDir = resolveRegistryDir({ flag: args.registry, env });
  if (!fs.existsSync(path.join(registryDir, "recipes", "index.json"))) {
    err(`land-lessons: no registry at ${registryDir} (recipes/index.json missing)`);
    return 2;
  }

  let lessons;
  try {
    lessons = args.fromFile ? readLessonsFile(args.fromFile) : await fetchPending(baseUrl, args.workspace, env);
  } catch (e) {
    err(`land-lessons: cannot read lessons - ${e.message}`);
    return 2;
  }

  let plan;
  try {
    plan = planLanding(lessons, registryDir);
  } catch (e) {
    err(`land-lessons: cannot plan - ${e.message}`);
    return 2;
  }
  for (const s of plan.skipped) log(`skip ${s.id ?? "?"} (${s.slug ?? "?"}): ${s.reason}`);
  for (const d of plan.dropped) log(`drop a bullet of ${d.id} (${d.slug}): ${d.reason}`);

  const byFile = new Map();
  for (const g of plan.groups) {
    const list = byFile.get(g.file) ?? [];
    list.push(g);
    byFile.set(g.file, list);
  }

  if (args.dryRun) {
    for (const [, gs] of byFile) {
      log(`\n--- would append to ${gs[0].rel}`);
      for (const g of gs) log(renderBlock(g));
    }
    log(`\ndry run: ${plan.groups.length} block(s), ${plan.landedIds.length} lesson(s) would land; nothing written`);
    return 0;
  }

  const shouldMark = !args.fromFile && !args.noCommit ? true : args.mark;

  if (byFile.size > 0) {
    const before = runRegistryCheck(registryDir, env);
    if (!before.ok) {
      err(`land-lessons: the registry gate is red BEFORE landing - refusing to write\n${before.output.trim()}`);
      return 1;
    }
    const originals = new Map();
    try {
      for (const [abs, gs] of byFile) {
        const original = plan.files.find((f) => f.abs === abs).original;
        originals.set(abs, original);
        fs.writeFileSync(abs, appendBlocks(original, gs.map(renderBlock)));
      }
    } catch (e) {
      for (const [abs, original] of originals) fs.writeFileSync(abs, original);
      err(`land-lessons: write failed, restored - ${e.message}`);
      return 1;
    }
    const after = runRegistryCheck(registryDir, env);
    if (!after.ok) {
      for (const [abs, original] of originals) fs.writeFileSync(abs, original);
      err(`land-lessons: the registry gate failed after writing - restored ${originals.size} file(s)\n${after.output.trim()}`);
      return 1;
    }
    const rels = [...byFile.values()].map((gs) => gs[0].rel);
    for (const rel of rels) log(`appended: ${rel}`);
    if (!args.noCommit) {
      try {
        const { sha, strangers } = commitOnly(registryDir, rels, commitMessage(plan.groups));
        log(`committed ${sha.slice(0, 10)} in the registry (${rels.length} file(s); not pushed)`);
        if (strangers.length > 0) log(`left staged and uncommitted (not ours): ${strangers.join(", ")}`);
      } catch (e) {
        err(`land-lessons: commit failed - ${e.message} (the appended files are left in place for inspection; kp was not marked)`);
        return 1;
      }
    } else log("--no-commit: the appended files are left uncommitted");
  } else log("nothing new to append");

  if (plan.landedIds.length > 0 && shouldMark) {
    try {
      const n = await markLanded(baseUrl, args.workspace, plan.landedIds, env);
      log(`marked ${n} of ${plan.landedIds.length} lesson(s) landed in kp`);
    } catch (e) {
      err(`land-lessons: marking failed - ${e.message}. A rerun finds these bullets already present and marks them then.`);
      return 1;
    }
  } else if (plan.landedIds.length > 0) log(`not marked in kp (${plan.landedIds.length} lesson(s)); pass --mark to mark them`);

  log(`landed ${plan.landedIds.length} lesson(s); skipped ${plan.skipped.length}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
