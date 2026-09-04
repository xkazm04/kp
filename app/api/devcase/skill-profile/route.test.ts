// TENANCY pin for the Durable Skill Profile MINT, driven through the REAL route handler.
//
// The defect: `issueSkillProfile(submissionId)` resolves the submission with
// `getSubmission` — a by-id point read on a globally-unique id — so a submission id
// belonging to ANOTHER team came back unguarded. The route then handed the caller the
// minted credential's CSPRNG `access_token`, which is the SOLE auth on the public
// /skill/[token] card and on GET /api/skill-profile/[token]/verify: with it, the caller
// reads that team's candidate's transfer score, axes and confidence. The mint is not even
// read-only — it stamps a skill_profiles row into the other team's workspace and, when the
// evaluation has moved since the last mint, REVOKES their live credential and reissues it
// under a new token, breaking every /skill link the candidate had already shared.
// `/api/devcase/promote` and `/api/devcase/feedback` already make this ownership check.
//
// The handler takes its tenant from currentWorkspace(), which reads cookies() — that throws
// outside a request and falls back to the DEFAULT workspace, so the caller here IS the
// default team and a submission owned by anyone else must be refused.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// A dedicated credential key so signNewSkillProfile can actually sign (it refuses to mint
// an unverifiable credential when neither KP_SKILL_PROFILE_KEY nor KP_SECRET is set).
process.env.KP_SKILL_PROFILE_KEY = "test-skill-profile-key";
process.env.KP_SKILL_PROFILE_KEY_ID = "k1";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, createPosting, createSubmission, saveSubmissionEvaluation } = await import(
  "../../../_lib/db/devcase.ts"
);
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

const WS_THEIRS = "ws-dsp-beta";

let seedN = 0;
/** A case → posting → EVALUATED submission chain owned by `ws`, scored substantively
 *  enough that the mint's earned-not-given check passes. */
function seedEvaluatedSubmission(ws: string, candidate: string): string {
  const dc = saveDevCase(
    { need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } },
    ws
  );
  const posting = createPosting({
    caseId: dc.id,
    channel: "link",
    token: `tok-dsp-${++seedN}`,
    roleTitle: "Backend Engineer",
    caseTitle: "API case",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: candidate,
    repoRef: `https://example.test/${candidate}`,
    contact: `${candidate}@example.test`,
  });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { dimensionScores: { judgment: 74, framing: 68 }, confidence: 0.8 },
      transfer: { transferScore: 71 },
    },
    71
  );
  return submission.id;
}

/** How many credentials exist for a submission — the durable proof that a refused mint
 *  wrote nothing into the other team's studio. */
function profileCount(submissionId: string): number {
  const row = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM skill_profiles WHERE submission_id = ?`)
    .get(submissionId) as { n: number };
  return Number(row.n);
}

function mintReq(submissionId: unknown) {
  return new Request("http://localhost/api/devcase/skill-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}

test("minting a credential for ANOTHER team's submission is refused — no token, no row", async () => {
  const theirs = seedEvaluatedSubmission(WS_THEIRS, "dana");

  const res = await POST(mintReq(theirs));

  // Pre-fix this was 200 and the body carried the live access token for THEIR candidate's
  // public score-card.
  assert.equal(res.status, 404, "a known submission id from another team must not be mintable");
  const body = (await res.json()) as { token?: string };
  assert.equal(body.token, undefined, "no credential token may cross the tenant boundary");
  assert.equal(profileCount(theirs), 0, "nothing was minted into the other team's studio");
});

test("minting for your OWN team's submission still works (the guard is not over-broad)", async () => {
  const mine = seedEvaluatedSubmission(DEFAULT_WORKSPACE_ID, "ada");

  const res = await POST(mintReq(mine));

  assert.equal(res.status, 200);
  const body = (await res.json()) as { token?: string; created?: boolean };
  assert.ok(body.token, "the owning team gets the candidate-owned token");
  assert.equal(body.created, true);
  assert.equal(profileCount(mine), 1);

  // Idempotent: the same submission hands back the SAME credential, never a second row.
  const again = (await (await POST(mintReq(mine))).json()) as { token?: string; created?: boolean };
  assert.equal(again.token, body.token);
  assert.equal(again.created, false);
  assert.equal(profileCount(mine), 1);
});

test("an unknown submission id answers the same 404 — never an existence oracle", async () => {
  const res = await POST(mintReq("sub-does-not-exist"));
  assert.equal(res.status, 404);
});


// ---- every refusal answers a CODE, never English prose -------------------------
//
// The mint's four refusals were bare English sentences with no code, on a door whose
// consumer (useDevSubmissionRow -> DevSubmissionRowSkillProfile) resolves `errors.<CODE>`
// in the reader's language and shows a neutral generic when there is none. So a
// recruiter working in cs/de/fr got the generic for every one of them, and the
// difference between "evaluate this first" and "that submission is not yours" was lost.
test("the missing-id 400 answers DEVCASE_SUBMISSION_ID_REQUIRED", async () => {
  const res = await POST(mintReq(""));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "DEVCASE_SUBMISSION_ID_REQUIRED");
});

test("both 404s answer the SAME DEVCASE_SUBMISSION_NOT_FOUND (never an existence oracle)", async () => {
  const unknown = (await (await POST(mintReq("sub-still-does-not-exist"))).json()) as { code?: string };
  assert.equal(unknown.code, "DEVCASE_SUBMISSION_NOT_FOUND");
  const theirs = seedEvaluatedSubmission(WS_THEIRS, "erin");
  const cross = await POST(mintReq(theirs));
  assert.equal(cross.status, 404);
  assert.equal(((await cross.json()) as { code?: string }).code, unknown.code, "the two 404s must be indistinguishable");
});

test("an unevaluated submission answers 409 DEVCASE_SUBMISSION_NOT_EVALUATED", async () => {
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } }, DEFAULT_WORKSPACE_ID);
  const posting = createPosting({ caseId: dc.id, channel: "link", token: `tok-dsp-raw-${Date.now()}`, roleTitle: "Backend Engineer", caseTitle: "API case" });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: "flo", repoRef: "https://example.test/flo" });
  const res = await POST(mintReq(submission.id));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code?: string }).code, "DEVCASE_SUBMISSION_NOT_EVALUATED");
});
