// Every RECRUITER door reads a role's lifecycle as the caller's team sees it.
//
// A shared corpus role (jobs.workspace_id NULL) keeps its per-team lifecycle - closed or
// live, hire target, posting languages - in job_workspace_state, and the reads take the
// team as a parameter. `getJobStatus` and `getRoleOpenConfig` REQUIRE it (tsc holds
// those). `getJob` keeps it optional, because most of its ~50 callers read nothing but
// the payload and the public candidate doors legitimately read the FILING team's view
// (their applicants file there). Optional is exactly how the gap this guards opened:
// ~25 gated routes called getJob(id) with no team, so a team that closed a corpus role
// still saw it live on its job page, palette and sim intake.
//
// So this is a source guard with an EMPTY exemption list: in every route the proxy
// gates (derived from the same allow-list the proxy uses, app/_lib/auth/public-routes.ts,
// so a route cannot dodge it by being misfiled), and in every recruiter-only library
// module that reads a role, each call to these reads names a team.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPublicPath } from "../_lib/auth/public-routes.ts";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(apiDir);

const READS = ["getJob", "getJobStatus", "getRoleOpenConfig"] as const;

/** Library modules that only ever serve a recruiter (or a task a recruiter enqueued),
 *  each with the team in hand. A module that also serves a public door is NOT listed:
 *  interview-run.ts (jobAsrKeywords + buildRehearsalBriefs serve the candidate's voice
 *  runtime), offer-finalize.ts (the public offer view), inbound-lead.ts (the channel
 *  door, which reads the webhook's filing team and is typed that way). */
const RECRUITER_LIBS = [
  "_lib/agent-hire/transform-run.ts",
  "_lib/analyze-run.ts",
  "_lib/ats-egress.ts",
  "_lib/campaign-run.ts",
  "_lib/group-eval-run.ts",
  "_lib/interview-kit-run.ts",
  "_lib/interview-letter-run.ts",
  "_lib/job-translate-run.ts",
  "_lib/palette-preview/resolve-entities.ts",
  "_lib/reasoning-run.ts",
  "_lib/rediscover.ts",
  "_lib/stage-hooks-homework.ts",
  "_lib/stage-hooks-role-fill.ts",
];

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(full, out);
    else if (e.name === "route.ts") out.push(full);
  }
  return out;
}

/** `/api/jobs/[id]` for app/api/jobs/[id]/route.ts - the pathname the proxy judges. */
function routePath(file: string): string {
  return "/api/" + path.relative(apiDir, path.dirname(file)).split(path.sep).join("/");
}

/** Drop comments so prose that NAMES a read (this repo explains itself a lot) is not
 *  mistaken for a call. Strings are left alone; none of these reads appears in one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every call to one of READS whose argument list has a single top-level argument,
 *  as `name(args)` snippets. A declaration (`function getJob(`) is not a call. */
function teamlessCalls(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  const re = new RegExp(`(?<![\\w.$])(${READS.join("|")})\\(`, "g");
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    let depth = 1;
    let commas = 0;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 1) commas++;
    }
    const args = code.slice(m.index + m[0].length, i - 1);
    // A trailing comma is not a second argument.
    const named = commas > 0 && args.replace(/,\s*$/, "").includes(",");
    if (!named) found.push(`${m[1]}(${args})`);
  }
  return found;
}

test("the parser catches the defect it exists for, and passes the fix", () => {
  assert.deepEqual(teamlessCalls(`const job = getJob(id);`), ["getJob(id)"]);
  assert.deepEqual(teamlessCalls(`if (!getJob(jdJobId(slug), ws)) return;`), []);
  assert.deepEqual(teamlessCalls(`getRoleOpenConfig(id).postingLangs`), ["getRoleOpenConfig(id)"]);
  assert.deepEqual(teamlessCalls(`getJobStatus(\n  id,\n)`), ["getJobStatus(\n  id,\n)"], "a trailing comma names no team");
  assert.deepEqual(teamlessCalls(`// getJob(id) in prose\n/* getJob(id) */`), []);
  assert.deepEqual(teamlessCalls(`export function getJob(id: string, workspaceId?: string) {}`), []);
  assert.deepEqual(teamlessCalls(`jobs.getJob(id); mygetJob(id)`), [], "only the reads themselves");
});

test("every gated route names the caller's team on a role lifecycle read", () => {
  const routes = walkRoutes(apiDir);
  assert.ok(routes.length > 150, `walked ${routes.length} routes - the walker lost the tree`);
  const gated = routes.filter((f) => !isPublicPath(routePath(f)));
  assert.ok(gated.length > 100 && gated.length < routes.length, "the public allow-list must split the tree");
  const offenders: string[] = [];
  let reads = 0;
  for (const file of gated) {
    const src = readFileSync(file, "utf8");
    reads += (stripComments(src).match(/(?<![\w.$])(getJob|getJobStatus|getRoleOpenConfig)\(/g) ?? []).length;
    for (const call of teamlessCalls(src)) offenders.push(`${routePath(file)}: ${call}`);
  }
  assert.ok(reads >= 25, `found ${reads} reads in gated routes - the matcher went blind`);
  assert.deepEqual(offenders, [], "a gated route read a corpus role's lifecycle as the FILING team, not the caller's");
});

test("every recruiter-only library module names the team on a role lifecycle read", () => {
  const offenders: string[] = [];
  for (const rel of RECRUITER_LIBS) {
    const src = readFileSync(path.join(appDir, rel), "utf8");
    assert.match(src, /(?<![\w.$])(getJob|getJobStatus|getRoleOpenConfig)\(/, `${rel} no longer reads a role - drop it from the list`);
    for (const call of teamlessCalls(src)) offenders.push(`${rel}: ${call}`);
  }
  assert.deepEqual(offenders, []);
});
