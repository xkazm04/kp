#!/usr/bin/env node
// The 55-context "one thread" roster (dev_goal 081c3e5a), re-keyed onto the CURRENT context map.
//
// The goal's denominator was named in the 143-map (docs/ship/2026-08-28-one-thread.md section 5):
// six groups = Job & JD Management 13, Developer Assessment 9, Voice Interviews 8, Candidate
// Matching & Scoring 7, Hiring Decisions & Automation 8, Hiring Pipeline 10. Context ids churn on
// every map rebuild, so the roster is pinned by FILE LIST (the only stable identity) and joined to
// whatever the map is now.
//
//   node scripts/scan/thread-roster.mjs --seed [<rev>]  # (re)read the old roster from git (default 9c20a787)
//   node scripts/scan/thread-roster.mjs                 # re-key onto context-map.json, rewrite the file
//   node scripts/scan/thread-roster.mjs --check         # fail if the committed re-key is stale vs the map
//   node scripts/scan/thread-roster.mjs --lenses        # per-lens file counts from coverage-*.md is NOT
//                                                       # attempted here: the recorded tables name contexts
//                                                       # by ids of THEIR map; see the roster's `oldName`.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROSTER = `${ROOT}.claude/scan-history/thread-roster.json`;
const THREAD_GROUPS = [
  "Job & JD Management", "Developer Assessment", "Voice Interviews",
  "Candidate Matching & Scoring", "Hiring Decisions & Automation", "Hiring Pipeline",
];
const args = process.argv.slice(2);
const readMap = () => JSON.parse(readFileSync(`${ROOT}context-map.json`, "utf8"));

function seed(rev) {
  const old = JSON.parse(execFileSync("git", ["show", `${rev}:context-map.json`], { cwd: ROOT, maxBuffer: 1 << 28, encoding: "utf8" }));
  const contexts = old.contexts ?? old.groups?.flatMap((g) => g.contexts ?? []) ?? old;
  const roster = contexts
    .filter((c) => THREAD_GROUPS.includes(c.group))
    .map((c) => ({ oldName: c.name, oldId: c.id, group: c.group, files: [...c.file_paths].sort() }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.oldName.localeCompare(b.oldName));
  return { sourceRev: rev, groups: THREAD_GROUPS, roster };
}

function rekey(doc, map) {
  const contexts = Array.isArray(map) ? map : map.contexts;
  const owner = new Map();
  for (const c of contexts) for (const f of c.file_paths ?? []) (owner.get(f) ?? owner.set(f, []).get(f)).push(c.id);
  const union = new Set();
  const roster = doc.roster.map((r) => {
    const counts = {};
    let gone = 0;
    for (const f of r.files) {
      const ids = owner.get(f);
      if (!ids) { gone++; continue; }
      for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
      ids.forEach((id) => union.add(id));
    }
    const currentContexts = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, files]) => ({ id, files }));
    return { ...r, filesNotInAnyCurrentContext: gone, currentContexts };
  });
  const allFiles = new Set(doc.roster.flatMap((r) => r.files));
  return {
    ...doc,
    currentMapContexts: contexts.length,
    summary: {
      rosterContexts: roster.length,
      rosterFiles: allFiles.size,
      currentContextsTouched: union.size,
      rosterNamesWithNoCurrentContext: roster.filter((r) => r.currentContexts.length === 0).map((r) => r.oldName),
    },
    roster,
  };
}

if (args.includes("--seed")) {
  const rev = args[args.indexOf("--seed") + 1]?.startsWith("-") ? undefined : args[args.indexOf("--seed") + 1];
  writeFileSync(ROSTER, JSON.stringify(rekey(seed(rev ?? "9c20a787"), readMap()), null, 1) + "\n");
  console.log("seeded and re-keyed", ROSTER);
} else {
  // Read first and treat ENOENT as "no roster": an exists-then-read pair can see two files.
  let committedText;
  try {
    committedText = readFileSync(ROSTER, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") { console.error("no roster; run with --seed first"); process.exit(1); }
    throw err;
  }
  const committed = JSON.parse(committedText);
  const fresh = rekey(committed, readMap());
  if (args.includes("--check")) {
    if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
      console.error("thread-roster.json is stale against context-map.json; run node scripts/scan/thread-roster.mjs");
      process.exit(1);
    }
    console.log("thread-roster current:", JSON.stringify(fresh.summary));
  } else {
    writeFileSync(ROSTER, JSON.stringify(fresh, null, 1) + "\n");
    console.log(JSON.stringify(fresh.summary));
  }
}
