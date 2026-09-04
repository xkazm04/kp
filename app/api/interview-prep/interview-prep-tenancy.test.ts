// TENANT SCOPE for the interview-prep artifact (/perfect 2026-09-03, schedule-ui-2).
//
// `interview_preps` has carried `workspace_id` since E0 Phase 1 and `saveInterviewPrep`
// stamps it from the linked pipeline entry — but `getInterviewPrep` read by entry id
// ALONE, and all four verbs of /api/interview-prep sit on it. The only thing standing
// between one team and another team's tailored interview plan, the interviewer's
// verbatim notes and their saved human scorecard was that entry ids are hard to guess:
// the GET returned the pack, and the POST/PATCH merged questions back INTO it.
//
// Two halves, because either alone is a hollow guard: the STORE must actually filter,
// and the ROUTE must actually pass the tenant it resolved.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { saveInterviewPrep, getInterviewPrep, listPreparedEntries } = await import("../../_lib/interview-prep.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "team-beta";

/** A pipeline entry owned by `ws`, plus a prep artifact saved against it. The save
 *  derives the prep's workspace from the entry, exactly as production does. */
function preppedEntry(ws: string, seq: number): string {
  const { entry } = createPipelineEntry({
    candidateId: `prep-tenancy-c${seq}`,
    candidateLabel: `Prep Tenancy ${seq}`,
    jobId: `prep-tenancy-job-${seq}`,
    jobTitle: "Prep Tenancy Role",
    workspaceId: ws,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, {
    scenario: `secret scenario for ${ws}`,
    userProgress: { notes: `verbatim notes belonging to ${ws}` },
  });
  return entry.id;
}

test("getInterviewPrep refuses an entry outside the caller's workspace", () => {
  const foreign = preppedEntry(OTHER_WS, 1);
  assert.equal(
    getInterviewPrep(foreign, DEFAULT_WORKSPACE_ID),
    null,
    "the default team must not read another team's interview plan, scenario or notes"
  );
  const own = getInterviewPrep(foreign, OTHER_WS);
  assert.ok(own, "the owning team still reads its own pack");
  assert.equal((own.payload as { scenario?: string }).scenario, `secret scenario for ${OTHER_WS}`);
});

test("getInterviewPrep still reads the caller's own pack (the scoping is a filter, not a wall)", () => {
  const mine = preppedEntry(DEFAULT_WORKSPACE_ID, 2);
  assert.ok(getInterviewPrep(mine), "the default-signature read serves the default tenant, as before");
  assert.ok(getInterviewPrep(mine, DEFAULT_WORKSPACE_ID), "and the same read named explicitly");
  assert.equal(getInterviewPrep(mine, OTHER_WS), null, "…and refuses the other team");
});

test("the roster read is scoped the same way", () => {
  // listPreparedEntries was already workspace-parameterised; pinned here so the two
  // reads of the same table can't drift back apart.
  const foreign = preppedEntry(OTHER_WS, 3);
  assert.equal(foreign in listPreparedEntries([foreign], DEFAULT_WORKSPACE_ID), false);
  assert.equal(foreign in listPreparedEntries([foreign], OTHER_WS), true);
});

test("all four verbs of /api/interview-prep pass the resolved workspace into getInterviewPrep", () => {
  // The store filtering is worthless if a handler calls the read unscoped. A source
  // guard, because currentWorkspace() reads cookies() and cannot be driven here.
  // Comments are stripped so only executable text can satisfy the assertion.
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const verb of ["GET", "PUT", "POST", "PATCH"]) {
    const start = src.indexOf(`export async function ${verb}(`);
    assert.ok(start >= 0, `${verb} handler must exist`);
    const next = ["GET", "PUT", "POST", "PATCH"]
      .map((v) => src.indexOf(`export async function ${v}(`, start + 1))
      .filter((i) => i > start);
    const body = src.slice(start, next.length ? Math.min(...next) : src.length);
    assert.match(body, /currentWorkspace\(\)/, `${verb} must resolve the tenant`);
    assert.match(
      body,
      /getInterviewPrep\(\s*entry\s*,\s*(ws|await currentWorkspace\(\))\s*\)/,
      `${verb} must read the prep artifact SCOPED to the resolved workspace`
    );
  }
});

// ---- the reader side: a non-default team must keep its own pack -----------------
//
// The workspace predicate closed a leak; the OTHER half of getting a default
// parameter right is that every caller which owns the entry keeps reading it. Six
// server-side readers passed no workspace at all, so on a non-default team each
// silently read `null` — the scheduling link's duration hint fell back to the quick
// screen, the voice brief lost its grounded chronology, and a regeneration dropped
// the interviewer's carried-forward notes. Not a leak; a quiet downgrade, which is
// exactly the failure a default parameter hides.

const { plannedInterviewMinutes } = await import("../../_lib/interview-planned-minutes.ts");
const { getPipelineEntry } = await import("../../_lib/db/pipeline.ts");

test("the planned-minutes path reads a NON-DEFAULT team's prep, not null", () => {
  const { entry } = createPipelineEntry({
    candidateId: "prep-minutes-c1",
    candidateLabel: "Prep Minutes",
    jobId: "prep-minutes-job",
    jobTitle: "Prep Minutes Role",
    workspaceId: OTHER_WS,
  });
  // A GROUNDED pack: a chronology plus an explicit 75-minute plan. Read correctly,
  // the scheduling link is minted for 75 minutes; read as null, it silently collapses
  // to the quick-screen floor.
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, {
    scenario: "grounded",
    durationMin: 75,
    chronology: [{ fromMin: 0, toMin: 75, topic: "t", goal: "g", questions: [] }],
    signals: [],
    focusAreas: [],
  });
  const row = getPipelineEntry(entry.id, OTHER_WS);
  assert.ok(row, "the fixture entry must exist on its own team");
  assert.equal(row.workspaceId, OTHER_WS, "PipelineEntry carries the tenant the reader needs");
  assert.equal(plannedInterviewMinutes(row), 75, "the entry's own workspace is what the prep read must use");
});

test("POST /api/interview-prep/scorecard refuses a foreign entry id", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "prep-scorecard-c1",
    candidateLabel: "Prep Scorecard",
    jobId: "prep-scorecard-job",
    jobTitle: "Prep Scorecard Role",
    workspaceId: OTHER_WS,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "other team's plan" });

  // currentWorkspace() reads cookies(), which throws outside a request and falls back
  // to the default workspace — so "the caller" here is the default tenant holding
  // another team's entry id. saveHumanScorecard is an unscoped by-id point op, so
  // without a gate this OVERWRITES that team's scorecard.
  const { POST } = await import("./scorecard/route.ts");
  // The handler reads `request.nextUrl.searchParams`, `request.headers` (the key the
  // per-IP limiter is built from) and `request.json()` and nothing else. Neither the real
  // NextRequest (outside a Next request context) nor the test shim populates `nextUrl`,
  // so the three members the handler actually uses are supplied directly — the
  // alternative is booting Next to assert a workspace predicate. Empty headers are the
  // honest shape: with no trusted proxy declared `clientIpFrom` answers
  // SHARED_CLIENT_KEY, which is exactly what a real self-hosted deploy does.
  const url = new URL(`http://localhost/api/interview-prep/scorecard?entry=${encodeURIComponent(entry.id)}`);
  const res = (await POST({
    nextUrl: url,
    headers: new Headers(),
    json: async () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }),
  } as never)) as unknown as Response;
  assert.equal(res.status, 404, "a foreign entry id must be refused, not written");

  const untouched = getInterviewPrep(entry.id, OTHER_WS);
  assert.ok(untouched, "the owning team's pack still exists");
  assert.equal(
    (untouched.payload as { humanScorecard?: unknown }).humanScorecard,
    undefined,
    "and carries no scorecard written by the other team"
  );
});
