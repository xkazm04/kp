// The voice-interviewer eval (pipeline/jobfit/eval/interview_eval.py) reads its briefs
// from a COMMITTED snapshot, pipeline/jobfit/eval/interview_briefs.json, instead of a
// hand-kept Python port or a live node subprocess. This file is what makes that snapshot
// a derivation rather than a copy: it re-renders every kind through the production
// builders and holds the committed file to them.
//
//   1. default / student / case / grounded rendered with the role sentinel equal the
//      committed templates exactly; a doctored copy fails, naming the kind and the
//      regenerate command (npm run interview:briefs).
//   2. substituting a real role (or '' -> the recorded fallbackRole) into a template
//      gives exactly what the builder returns for that role — the substitution Python
//      performs is proven faithful here, not assumed.
//   3. the grounded render is byte-stable across two throwaway databases and carries
//      no entry id, timestamp or temp path.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb, UNIT_DB_DIR } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BRIEF_KINDS,
  BRIEF_SNAPSHOT_PATH,
  REGENERATE_COMMAND,
  ROLE_SENTINEL,
  compareSnapshot,
  parseSnapshot,
  renderBriefSnapshot,
  renderGrounded,
  renderKind,
  substituteRole,
  type BriefSnapshot,
} from "../../../scripts/interview-briefs-snapshot.ts";
import { defaultInterviewerInstructions } from "./index.ts";
import { studentInterviewerInstructions } from "../student-interview.ts";

after(() => cleanupUnitDb());

const ROOT = process.cwd();

function committed(): BriefSnapshot {
  return parseSnapshot(readFileSync(path.join(ROOT, BRIEF_SNAPSHOT_PATH), "utf8"));
}

test("the committed snapshot is exactly what the production builders render with the sentinel", async () => {
  const live = await renderBriefSnapshot();
  const snap = committed();
  assert.deepEqual([...Object.keys(snap.kinds)].sort(), [...BRIEF_KINDS].sort());
  assert.deepEqual(compareSnapshot(snap, live), [], "regenerate with npm run interview:briefs");
  for (const kind of BRIEF_KINDS) {
    assert.ok(snap.kinds[kind].template.includes(ROLE_SENTINEL), `${kind}: the sentinel marks where the role goes`);
  }
});

test("a doctored snapshot fails, and the failure names the kind and the regenerate command", async () => {
  const live = await renderBriefSnapshot();
  const doctored: BriefSnapshot = JSON.parse(JSON.stringify(committed()));
  doctored.kinds.student.template = doctored.kinds.student.template.replace(
    "Anchor in THEIR concrete projects",
    "Anchor in hypotheticals",
  );
  assert.notEqual(doctored.kinds.student.template, committed().kinds.student.template, "the doctoring took");
  const problems = compareSnapshot(doctored, live);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /student/);
  assert.ok(problems[0].includes(REGENERATE_COMMAND), problems[0]);
  // A doctored fallback is caught the same way.
  const badFallback: BriefSnapshot = JSON.parse(JSON.stringify(committed()));
  badFallback.kinds.default.fallbackRole = "a made-up role";
  const fb = compareSnapshot(badFallback, live);
  assert.equal(fb.length, 1, fb.join("\n"));
  assert.match(fb[0], /default/);
  assert.ok(fb[0].includes(REGENERATE_COMMAND), fb[0]);
});

test("substituting a role into the default and student templates gives exactly the builder's brief", () => {
  const snap = committed();
  for (const role of ["a senior backend engineering role", "Datový analytik (medior)", ""]) {
    assert.equal(
      substituteRole(snap.kinds.default.template, role, snap.kinds.default.fallbackRole),
      defaultInterviewerInstructions({ role }),
      `default, role ${JSON.stringify(role)}`,
    );
    assert.equal(
      substituteRole(snap.kinds.student.template, role, snap.kinds.student.fallbackRole),
      studentInterviewerInstructions({ roleLine: role }),
      `student, role ${JSON.stringify(role)}`,
    );
  }
});

test("the grounded template with a title gives exactly buildGroundedInterview over the fixture entry", async () => {
  const snap = committed();
  const { brief } = await renderGrounded("Senior Backend Engineer");
  assert.equal(
    substituteRole(snap.kinds.grounded.template, "Senior Backend Engineer", snap.kinds.grounded.fallbackRole),
    brief,
  );
  assert.ok(brief.includes("Recent backend ownership"), "the fixture's run of show reached composeBrief");
});

test("every kind's recorded fallbackRole reproduces the builder's empty-role brief", async () => {
  const snap = committed();
  for (const kind of BRIEF_KINDS) {
    const { template, fallbackRole } = snap.kinds[kind];
    assert.ok(fallbackRole.length > 0, `${kind}: a fallback is recorded`);
    assert.equal(substituteRole(template, "", fallbackRole), await renderKind(kind, ""), kind);
  }
});

function snapshotFromChild(): { snapshot: BriefSnapshot; stdout: string } {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "scripts/interview-briefs-snapshot.ts",
      "--stdout",
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
  );
  assert.equal(res.status, 0, `snapshot child failed\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return { snapshot: parseSnapshot(res.stdout), stdout: res.stdout };
}

test("the grounded render is byte-stable across two throwaway databases and leaks nothing run-specific", async () => {
  const a = snapshotFromChild();
  const b = snapshotFromChild();
  assert.equal(a.snapshot.kinds.grounded.template, b.snapshot.kinds.grounded.template);
  assert.equal(a.stdout, b.stdout, "the whole snapshot is byte-identical run to run");
  assert.equal(a.stdout, readFileSync(path.join(ROOT, BRIEF_SNAPSHOT_PATH), "utf8"), "and equals the committed file");

  const { entryId } = await renderGrounded(ROLE_SENTINEL);
  const text = a.stdout;
  assert.ok(entryId && !text.includes(entryId), `the fixture entry id ${entryId} does not leak`);
  assert.ok(!text.includes(UNIT_DB_DIR), "no temp path leaks");
  assert.doesNotMatch(text, /kp-brief-snapshot-|kp-unit-db/, "no throwaway-dir name leaks");
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "no timestamp leaks");
  assert.ok(!text.includes("\r"), "LF line endings");
});
