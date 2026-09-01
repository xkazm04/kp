// no-silent-lifecycle-states — source guards for two states the jobs surface used to
// swallow. Both are client/route wiring behind cookie auth, so they're asserted at the
// source level (the same style as close-tenancy.test.ts).
//
//  1. close's withdrawal step is best-effort; when it THREW, the response was still
//     ok:true/withdrawn:0 and the modal rendered nothing — "empty funnel" and
//     "withdrawal broke" were one silent state. The route now reports withdrawalFailed
//     and the modal renders both cases (the zero case wires jobs.posting.closedNow,
//     which was translated in every catalog and referenced nowhere).
//  2. a ?job= deep link whose target sits outside the ranked LIMIT-300 list slice used
//     to stamp the once-per-param guard and do nothing. The tab now point-fetches the
//     job by id and only shows "not found" when that 404s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(dir, ...p), "utf8");

test("POST /api/jobs/[id]/close distinguishes a failed withdrawal from a genuine zero", () => {
  const src = read("[id]", "close", "route.ts");
  assert.match(src, /withdrawalFailed = true/, "the withdrawal catch must record the failure");
  assert.match(src, /NextResponse\.json\(\{[^}]*withdrawalFailed[^}]*\}\)/, "the close response must carry withdrawalFailed");
});

test("the posting modal renders the zero-withdrawal and failed-withdrawal close states", () => {
  // The modal is split across a logic hook (state + the close call) and a footer
  // (the rendered outcome), so the two halves of this contract are asserted where
  // each now lives.
  const logic = read("..", "..", "features", "library", "jobs", "jobsPostingModalLogic.ts");
  assert.match(logic, /withdrawalFailed\?: boolean/, "the modal must read the route's failure flag");
  const footer = read("..", "..", "features", "library", "jobs", "JobsPostingModalFooter.tsx");
  assert.match(footer, /t\("withdrawFailed"\)/, "a failed withdrawal must be surfaced");
  assert.match(footer, /t\("closedNow"\)/, "withdrawn:0 must still confirm the close (the orphan key)");
});

test("GET /api/jobs/[id] exists and is scoped like the list query", () => {
  const src = read("[id]", "route.ts");
  assert.match(src, /export async function GET/);
  assert.match(src, /jobVisibleToWorkspace\(id, ws\)/, "a point-fetch must not hand out what the list wouldn't");
  assert.match(src, /status: 404/, "an invisible/unknown job must 404, not leak existence");
});

// GET /api/jobs paired a PAGE (listJobs binds LIMIT 300) with jobStats' real,
// UNFILTERED COUNT, so a workspace of 340 roles rendered "Showing 300 of 340" with 40
// roles unreachable — no pager, no load-more — and the gap read as ordinary filtering
// because the total was genuine. The page read now looks one row past the slice and the
// response carries `truncated` plus `matching`, an unbounded COUNT over the SAME bound
// filter, so the summary can separate "300 of 340 in this workspace" from "300 of 312
// matching, cut".
test("GET /api/jobs reports truncation and a count over the same predicate", () => {
  const src = read("route.ts");
  assert.match(src, /listJobsPage\(filter, ws\)/, "the browse read must use the page reader that knows it was cut");
  assert.match(src, /countJobs\(filter, ws\)/, "the count must run the SAME bound filter object as the page");
  assert.match(
    src,
    /NextResponse\.json\(\{[^}]*\btruncated\b[^}]*\}\)/,
    "the response must carry the truncation flag the client needs",
  );
  assert.match(src, /NextResponse\.json\(\{[^}]*\bmatching\b[^}]*\}\)/, "…and the filtered count beside it");
});

// POST /api/jobs/ingest is a by-id WRITE whenever the caller names a jobId: insertJob's
// ON CONFLICT UPDATE rewrites that row's title/company/salary/payload. Unguarded, team B
// could rewrite team A's live opening (the row keeps A's workspace_id and 'published'
// status, so A's catalog and apply link start serving B's ad). Without a jobId the
// parser's id is only a slug of the ad's TITLE, so it must fork on a collision rather
// than overwrite — see app/_lib/job-ingest.test.ts for that half, behaviorally.
test("POST /api/jobs/ingest gates an explicit jobId on ownership and marks a minted id as derived", () => {
  const src = read("ingest", "route.ts");
  assert.match(
    src,
    /if \(explicitJobId && !canWriteJobLifecycle\(explicitJobId, ws\)\)[\s\S]{0,160}?status: 404/,
    "an explicit jobId the caller doesn't own must 404",
  );
  const gateAt = src.indexOf("canWriteJobLifecycle(explicitJobId, ws)");
  const spendAt = src.indexOf("ingestJobAd(");
  assert.ok(gateAt > 0 && spendAt > gateAt, "the gate must precede the LLM parse — a refused ingest must not spend");
  assert.match(src, /derivedId: !explicitJobId/, "a minted (title-slug) id must be flagged so a collision forks");
});

// Every by-id job route is a point read over a globally-unique PK, so it answers for any
// tenant unless it re-applies the list's visibility predicate. These all spend
// (an LLM call or a recruiter_cli child) AND hand back content derived from the role, so
// an unguarded one leaks another team's opening and bills the caller's provider for it.
//
// `spend` is the first line that costs something — the gate has to sit ABOVE it, or a
// refused request has already paid. `candidates` and `candidates/outreach` were the two
// members of this family the original fix missed: both were reachable with any tenant's
// job id, and outreach additionally files a pipeline row stamped with that role's title.
const VISIBILITY_GATED: ReadonlyArray<{ segments: readonly string[]; spend: string }> = [
  { segments: ["campaign"], spend: "runCampaign(" },
  { segments: ["winnability"], spend: "buildCandidatePool(" },
  { segments: ["rediscover"], spend: "rediscoverForJob(" },
  { segments: ["agent-fit"], spend: 'startTask("agent_fit"' },
  { segments: ["candidates"], spend: "await rankPoolForJob" },
  // `await` prefixes deliberately: the bare identifier also appears in each file's
  // header comment and import list, both above the gate.
  { segments: ["candidates", "outreach"], spend: "await runAutomationTask(" },
];

for (const { segments, spend } of VISIBILITY_GATED) {
  const name = segments.join("/");
  test(`GET/POST /api/jobs/[id]/${name} re-applies the list's visibility predicate`, () => {
    const src = read("[id]", ...segments, "route.ts");
    assert.ok(src.includes("jobVisibleToWorkspace(id, "), `${name} must not answer for a job the list would hide`);
    assert.match(src, /status: 404/, "an invisible job must 404, not leak existence");
    const gateAt = src.indexOf("jobVisibleToWorkspace(id, ");
    const spendAt = src.indexOf(spend);
    assert.ok(spendAt > 0, `${name}: the spend marker ${spend} moved — re-point this assertion`);
    assert.ok(gateAt < spendAt, `${name}: the gate must precede the spend — a refused request must not have cost anything`);
  });
}

test("the Jobs tab falls back to the by-id fetch when a ?job= deep link misses the slice", () => {
  // Deep-link resolution lives in the tab's extracted hook; the notice it drives is
  // rendered by the tab itself.
  const hook = read("..", "..", "features", "library", "jobs", "jobsTabDeepLink.ts");
  assert.match(hook, /fetch\(`\/api\/jobs\/\$\{encodeURIComponent\(lookupId\)\}`\)/, "the miss must point-fetch the target");
  assert.match(hook, /setLookupMissed\(true\)/, "only a failed point-fetch is a real miss");
  const tab = read("..", "..", "features", "library", "jobs", "JobsTab.tsx");
  assert.match(tab, /td\("notFound"\)/, "a real miss must be told to the user");
});
