#!/usr/bin/env node
// KPI meter — "Role-run delivery anchors" (Personas KPI df4812da, goal 14b80beb
// "One role runs end to end without a human step").
//
// WHY A PROXY. The goal's own outcome (how many stages of a role run reach the
// next one with no human step) has no instrument on any tree: the read that
// would compute it (idea 42a4ecec, `app/_lib/thread-autonomy.ts`) is accepted
// and unshipped. So this counts the SEVEN code anchors the ADR-0009/ADR-0010
// delivery wave must land before the outcome is even measurable. It is a
// delivery proxy and says so in its own output — do not quote it as autonomy.
//
// WHY A SCRIPT AND NOT PROSE. The same seven checks used to live as English in
// the KPI's measure_config, which meant every back-measure was a fresh
// investigation of what the words meant. Here they are executable against ANY
// ref, so once the open PRs merge the back-measure is `--ref origin/main` and a
// subtraction.
//
// Keyless, network-free, read-only: every check is `git` against a ref, so it
// never touches the working tree and never needs a checkout. Run `git fetch`
// first when the ref is a remote one.
//
//   node scripts/kpi/role-run-anchors.mjs                 # origin/main
//   node scripts/kpi/role-run-anchors.mjs --ref HEAD --json
//
// Exit 0 = a number was produced. Exit 2 = the ref does not resolve, so NO
// number is printed rather than a zero that reads like a regression.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const refArg = args.indexOf("--ref");
const REF = refArg >= 0 ? args[refArg + 1] : "origin/main";
const JSON_OUT = args.includes("--json");

/** A git probe that answers only "did this succeed": a non-zero exit is the
 *  answer "absent", never a crash — `git grep` exits 1 on no-match by design. */
function gitOk(argv) {
  try {
    execFileSync("git", argv, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitOut(argv) {
  try {
    return execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

// The seven anchors, in the order the delivery wave lands them. Each is a
// FILE-OR-SYMBOL existence question with one right answer, never a judgement:
// an anchor a reviewer could argue about is not an anchor.
const ANCHORS = [
  {
    key: "ledger_ddl",
    what: "role_run* tables exist (ADR-0009 R1: the run is a ledger of stage artifacts)",
    test: (ref) => gitOk(["grep", "-qE", "CREATE TABLE IF NOT EXISTS role_run", ref, "--", "app/"]),
  },
  {
    key: "stage_contract",
    what: "app/_lib/role-run-stages.ts — the stage vocabulary + nextStageFor() resume read (R2)",
    test: (ref) => gitOk(["cat-file", "-e", `${ref}:app/_lib/role-run-stages.ts`]),
  },
  {
    key: "gates",
    what: "the three approval gates are their own module (role-run-gates.ts | role-run-approval.ts)",
    test: (ref) => gitOk(["grep", "-ql", "role.\\?run", ref, "--", "app/_lib/role-run-gates.ts", "app/_lib/role-run-approval.ts"]),
  },
  {
    key: "rubric_store",
    what: "role_rubrics store (ADR-0010 inc. 1: one frozen, versioned rubric per job)",
    test: (ref) => gitOk(["grep", "-q", "role_rubrics", ref, "--", "app/"]),
  },
  {
    key: "rubric_derivation",
    what: "pipeline/jobfit/rolerubric.py — deterministic RoleBrief -> rubric (ADR-0010 inc. 2)",
    test: (ref) => gitOk(["cat-file", "-e", `${ref}:pipeline/jobfit/rolerubric.py`]),
  },
  {
    key: "autonomy_read",
    what: "app/_lib/thread-autonomy.ts — the read that would score the GOAL itself (idea 42a4ecec)",
    test: (ref) => gitOk(["cat-file", "-e", `${ref}:app/_lib/thread-autonomy.ts`]),
  },
  {
    key: "adr_0009",
    what: "the ADR-0009 record is in the decision index",
    test: (ref) => /\/0009-/.test(gitOut(["ls-tree", "--name-only", ref, "docs/architecture/decisions/"])),
  },
];

if (!gitOk(["rev-parse", "--verify", `${REF}^{commit}`])) {
  console.error(`role-run-anchors: ref "${REF}" does not resolve — no reading taken.`);
  console.error(`  (a remote ref needs \`git fetch origin\` first; 0/7 from a missing ref is a lie, not a baseline)`);
  process.exit(2);
}

const sha = gitOut(["rev-parse", "--short", REF]).trim();
const results = ANCHORS.map((a) => ({ key: a.key, what: a.what, present: a.test(REF) }));
const value = results.filter((r) => r.present).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ ref: REF, sha, value, denominator: ANCHORS.length, anchors: results }, null, 2));
} else {
  for (const r of results) console.log(`  ${r.present ? "PRESENT" : "absent "}  ${r.key.padEnd(18)} ${r.what}`);
  console.log(`ANCHORS=${value}/${ANCHORS.length} at ${REF}=${sha}`);
}
