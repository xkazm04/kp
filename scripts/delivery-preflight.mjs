#!/usr/bin/env node
// delivery-preflight - a READ-ONLY reporter run before a delivery wave is dispatched.
// It prints three sections and always exits 0 (it is not a gate):
//   1. local-vs-origin divergence for the base branch (origin is the only truth)
//   2. the base's latest CI conclusions (needs `gh`; says so when it is missing)
//   3. open PRs with mergeStateStatus, so an unmerged stack is visible
// Usage: node scripts/delivery-preflight.mjs [base=main]
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "main";

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim().split("\n")[0] };
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

section(`1. ${base}: local vs origin`);
const fetched = run("git", ["fetch", "--quiet", "origin", base]);
if (!fetched.ok) console.log(`could not fetch origin/${base} (${fetched.out}); comparing against the last known ref`);
const counts = run("git", ["rev-list", "--left-right", "--count", `${base}...origin/${base}`]);
if (counts.ok) {
  const [ahead, behind] = counts.out.split(/\s+/).map(Number);
  console.log(`local ${base} is ${ahead} ahead / ${behind} behind origin/${base}`);
  if (ahead > 0) console.log("  -> local-only commits: plan against origin/" + base + ", not against this tree");
} else {
  console.log(`unavailable: ${counts.out}`);
}

section(`2. origin/${base}: latest gate conclusions`);
const sha = run("git", ["rev-parse", `origin/${base}`]);
const runs = sha.ok
  ? run("gh", ["run", "list", "--branch", base, "--limit", "8", "--json", "name,conclusion,status,headSha"])
  : sha;
if (runs.ok) {
  const rows = JSON.parse(runs.out);
  if (rows.length === 0) console.log("no runs found");
  for (const r of rows) {
    const mark = r.headSha === sha.out ? "head" : "old ";
    console.log(`${mark}  ${(r.conclusion || r.status).padEnd(10)} ${r.name}`);
  }
} else {
  console.log(`unavailable (gh missing or not authenticated): ${runs.out}`);
}

section("3. open PRs: merge state");
const prs = run("gh", ["pr", "list", "--base", base, "--state", "open", "--limit", "50", "--json", "number,title,mergeStateStatus,headRefName,baseRefName"]);
if (prs.ok) {
  const rows = JSON.parse(prs.out);
  if (rows.length === 0) console.log("no open PRs");
  for (const p of rows) console.log(`#${p.number}  ${String(p.mergeStateStatus).padEnd(10)} ${p.headRefName}  ${p.title}`);
  const stacked = run("gh", ["pr", "list", "--state", "open", "--limit", "50", "--json", "number,baseRefName,headRefName"]);
  if (stacked.ok) {
    const off = JSON.parse(stacked.out).filter((p) => p.baseRefName !== base);
    for (const p of off) console.log(`  stacked: #${p.number} targets ${p.baseRefName}, not ${base}`);
  }
} else {
  console.log(`unavailable (gh missing or not authenticated): ${prs.out}`);
}
process.exit(0);
