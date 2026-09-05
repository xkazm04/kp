// POST /api/sim/reset is the guided demo's FIRST call and had no test at all —
// while being the one door in the sim directory that runs DELETEs.
//
// Two things pinned here:
//   (1) BEHAVIOUR — the handler purges the caller's tenant and reports the counts,
//       and a run that only touched another tenant is untouched by it.
//   (2) CONTRACT — it answers a CODE on failure (SIM_RESET_FAILED), never the
//       thrown better-sqlite3 message, because the sim console paints the answer.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { register } from "node:module";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { createPipelineEntry, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { SIM_MARKER } from "@/app/features/shell/simulation/constants";
import { __resetSimRunLocks, simResidue, simRunActive } from "@/app/_lib/sim-store";
import { SIM_RUN_TOKEN_HEADER } from "@/app/features/shell/simulation/simRunLease";

after(() => cleanupUnitDb());

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));
const { GET, POST, DELETE } = await import("./route.ts");
const { NextRequest } = await import("next/server");

/** POST with an optional body. `hold` claims the workspace's run lock for a walk. */
function post(body?: { hold?: boolean; renew?: boolean }, token?: string) {
  return POST(
    new NextRequest("http://localhost:3000/api/sim/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { [SIM_RUN_TOKEN_HEADER]: token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );
}

/** DELETE, optionally presenting a lease token — the only thing that frees a live
 *  lease now (/perfect wave 44). No token is the REFUSED tab's shape. */
function del(token?: string) {
  return DELETE(
    new NextRequest("http://localhost:3000/api/sim/reset", {
      method: "DELETE",
      ...(token ? { headers: { [SIM_RUN_TOKEN_HEADER]: token } } : {}),
    })
  );
}

/** Claim the lock as a walk does and hand back the lease token the route minted. */
async function claim(): Promise<string> {
  const res = await post({ hold: true });
  assert.equal(res.status, 200);
  const { token } = (await res.json()) as { token?: string };
  assert.ok(token, "a held claim answers the lease token the claimant must present");
  return token;
}

// CRLF-normalized: this checkout is CRLF while the worktree may be LF, and the
// slices below are taken by offset.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8").replace(/\r\n/g, "\n");

// No next/headers shim: `cookies()` throws outside a request scope, which is the
// documented fallback path in currentWorkspace() — the caller resolves to the
// DEFAULT workspace, exactly the operator-tab case.
const CALLER_WS = DEFAULT_WORKSPACE_ID;
const OTHER_WS = "team-not-the-caller";

function simEntry(id: string, workspaceId: string) {
  return createPipelineEntry({
    candidateId: `reset-${id}`,
    candidateLabel: `Candidate ${id}`,
    jobId: `reset-job-${id}`,
    jobTitle: `Backend Engineer ${SIM_MARKER}`,
    workspaceId,
    stage: "Accepted",
  }).entry;
}

test("the handler purges the caller's SIM rows and reports the counts", async () => {
  const mine = simEntry("mine", CALLER_WS);
  const theirs = simEntry("theirs", OTHER_WS);
  const real = createPipelineEntry({
    candidateId: "reset-real",
    candidateLabel: "Real Candidate",
    jobId: "reset-job-real",
    jobTitle: "Backend Engineer",
    workspaceId: CALLER_WS,
    stage: "Accepted",
  }).entry;

  const res = await post();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; cleared: Record<string, number> };
  assert.equal(body.ok, true);
  assert.ok(body.cleared.entries >= 1, `the caller's marked entry is counted (${JSON.stringify(body.cleared)})`);

  assert.equal(getPipelineEntry(mine.id, CALLER_WS), null, "the caller's own SIM row is gone");
  assert.ok(getPipelineEntry(theirs.id, OTHER_WS), "another tenant's SIM row must survive a reset it did not ask for");
  assert.ok(getPipelineEntry(real.id, CALLER_WS), "an unmarked, real row is never touched by the purge");
});

test("the reset is idempotent — a second call clears nothing and still succeeds", async () => {
  const res = await post();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cleared: { entries: number } };
  assert.equal(body.cleared.entries, 0, "nothing left to clear, and that is a success, not an error");
});

test("a run holds the lock, so a SECOND start is refused instead of wiping the first", async () => {
  __resetSimRunLocks();
  const token = await claim();
  assert.equal(simRunActive(CALLER_WS).active, true);

  const second = await post({ hold: true });
  assert.equal(second.status, 409, "the second visitor is told, not served a wipe of someone else's tour");
  const body = (await second.json()) as { code: string; retryAfterSeconds: number };
  assert.equal(body.code, "SIM_RUN_ACTIVE");
  assert.ok(body.retryAfterSeconds > 0, "and told how long the holder's lease has left");

  // A manual reset is refused for the same reason while a walk is live.
  assert.equal((await post()).status, 409);

  const released = await del(token);
  assert.equal(released.status, 200);
  assert.equal(simRunActive(CALLER_WS).active, false, "the run ended: the tenant is free");
  assert.equal((await post({ hold: true })).status, 200, "and the next visitor may start");
  __resetSimRunLocks();
});

// The wave-22 regression, at the route: tab B's start is refused, and tab B's own
// end-of-run DELETE then arrives with no lease. Honouring it freed tab A's lock and
// the next press purged A's live run.
test("a DELETE from the tab that lost the race cannot free the winner's lease", async () => {
  __resetSimRunLocks();
  const token = await claim();

  assert.equal((await post({ hold: true })).status, 409, "tab B is refused");

  const stray = await del();
  assert.equal(stray.status, 409, "and its unconditional release is refused too");
  const body = (await stray.json()) as { code: string; retryAfterSeconds: number };
  assert.equal(body.code, "SIM_RUN_NOT_OWNER");
  assert.ok(body.retryAfterSeconds > 0, "with the holder's remaining lease as data");

  assert.equal((await del("some-other-tabs-token")).status, 409, "nor does a foreign token free it");
  assert.equal(simRunActive(CALLER_WS).active, true, "tab A still owns its tenant");
  assert.equal((await post({ hold: true })).status, 409, "so B's next press still cannot wipe A mid-walk");

  assert.equal((await del(token)).status, 200, "only the claimant ends the run");
  assert.equal(simRunActive(CALLER_WS).active, false);
  __resetSimRunLocks();
});

// Step mode is the walk's DEFAULT, so a presented run outlived its own five-minute
// protection and a colleague's Start could wipe the board mid-sentence.
test("the holder renews at a phase gate; nobody else can", async () => {
  __resetSimRunLocks();
  const token = await claim();
  const before = simRunActive(CALLER_WS).retryAfterMs;

  const renewed = await post({ renew: true }, token);
  assert.equal(renewed.status, 200);
  const body = (await renewed.json()) as { renewed: boolean; expiresInSeconds: number; cleared?: unknown };
  assert.equal(body.renewed, true);
  assert.equal(body.expiresInSeconds, 300, "a full TTL again");
  assert.equal(body.cleared, undefined, "the renew purges nothing, so it counts nothing");
  assert.ok(simRunActive(CALLER_WS).retryAfterMs >= before, "and the expiry moved out rather than in");

  assert.equal((await post({ renew: true })).status, 409, "a renew with no token is not the holder's");
  assert.equal((await post({ renew: true }, "some-other-tabs-token")).status, 409);
  const refused = (await post({ renew: true }, "some-other-tabs-token")).clone();
  assert.equal(((await refused.json()) as { code: string }).code, "SIM_RUN_NOT_OWNER");

  assert.equal(simRunActive(CALLER_WS).active, true, "and none of that disturbed the holder");
  assert.equal((await del(token)).status, 200);
  __resetSimRunLocks();
});

test("releasing when nothing is held is still a success, token or not", async () => {
  __resetSimRunLocks();
  assert.equal((await del()).status, 200, "a walk whose lease already expired must not see an error");
  assert.equal((await del("stale-token")).status, 200);
});

test("a manual reset holds the lock only for its own purge", async () => {
  __resetSimRunLocks();
  const res = await post();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).token, undefined, "and is handed no lease token: it holds nothing to release");
  assert.equal(simRunActive(CALLER_WS).active, false, "no `hold`, no lease left behind — otherwise a reset locked the tenant for 5 minutes");
});

test("a failure answers the CODE, never the thrown store message", () => {
  assert.match(src, /safeJsonError\(error, "api:sim\/reset", "SIM_RESET_FAILED"\)/, "the catch must go through the chokepoint");
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/, "no hand-rolled message forwarding");
});

test("the purge is scoped to the CALLER's tenant, not the default", () => {
  assert.match(src, /await currentWorkspace\(\)/, "the tenant comes from the session, never a hardcoded default");
  assert.match(src, /resetSim\(ws\)/, "and it is threaded into the purge");
  assert.match(src, /beginSimRun\(ws\)/, "the lock is per-workspace too");
});

test("the release re-asserts ownership rather than freeing whoever holds the lock", () => {
  assert.match(src, /endSimRun\(ws, leaseToken\(request\)\)/, "the DELETE presents the caller's token");
  assert.match(src, /jsonRefusal\("SIM_RUN_NOT_OWNER", 409/, "and answers a CODE when it is not the owner");
});

test("the renew never reaches the purge", () => {
  const renewBranch = src.slice(src.indexOf("if (body?.renew)"), src.indexOf("const claim = beginSimRun"));
  assert.doesNotMatch(renewBranch, /resetSim/, "a lease renewal that deleted rows would be the opposite of protection");
  assert.doesNotMatch(renewBranch, /beginSimRun/, "and it must not fall through to a claim that refuses its own holder");
});

// --- GET: the status door (/perfect wave 44) -----------------------------------
//
// The defect: the console's state was a BROWSER fact. The lease lives here, the
// provider boots to IDLE_STATE, and nothing asked — so a reloaded tab showed an
// idle deck whose Start was refused for up to five minutes with copy that said
// "stop it first" about a run that tab no longer knew it had begun.

/** GET, optionally presenting a lease token (the only way `ownedByMe` is true). */
function get(token?: string) {
  return GET(
    new NextRequest("http://localhost:3000/api/sim/reset", {
      method: "GET",
      ...(token ? { headers: { [SIM_RUN_TOKEN_HEADER]: token } } : {}),
    })
  );
}

test("the door reports a live lease, and only its holder is ownedByMe", async () => {
  __resetSimRunLocks();
  const idle = (await (await get()).json()) as { runActive: boolean; ownedByMe: boolean; retryAfterSeconds: number };
  assert.equal(idle.runActive, false, "a free tenant");
  assert.equal(idle.retryAfterSeconds, 0);

  const token = await claim();
  const held = (await (await get()).json()) as { runActive: boolean; ownedByMe: boolean; retryAfterSeconds: number };
  assert.equal(held.runActive, true, "a reloaded tab can now SEE the lease it cannot remember claiming");
  assert.equal(held.ownedByMe, false, "…and knows it is not the holder, because it presents no token");
  assert.ok(held.retryAfterSeconds > 0, "with the time it has to wait, as data");

  const mine = (await (await get(token)).json()) as { ownedByMe: boolean };
  assert.equal(mine.ownedByMe, true, "the holder's own token is what makes it its run");
  assert.equal((await (await get("some-other-tabs-token")).json()).ownedByMe, false);

  assert.equal(simRunActive(CALLER_WS).active, true, "and reading the door never touched the lease");
  assert.equal((await del(token)).status, 200);
  __resetSimRunLocks();
});

test("the door counts the residue a previous walk left, scoped to the caller's tenant", async () => {
  __resetSimRunLocks();
  await post(); // start from a clean tenant
  assert.equal(((await (await get()).json()) as { residue: { total: number } }).residue.total, 0);

  simEntry("residue-mine", CALLER_WS);
  simEntry("residue-theirs", OTHER_WS);
  const body = (await (await get()).json()) as { residue: { entries: number; total: number } };
  assert.equal(body.residue.entries, 1, "another tenant's (SIM) rows are not this console's mess");
  assert.ok(body.residue.total >= 1, "so an idle console can offer the Reset that clears it");

  // …and the purge is what makes it zero again: the console's reachability rule
  // (simRunControl.consoleMode) reads exactly this number.
  await post();
  assert.equal(((await (await get()).json()) as { residue: { total: number } }).residue.total, 0);
});

test("simResidue never claims a cold tenant is dirty", () => {
  const r = simResidue("workspace-that-never-ran-a-demo");
  assert.deepEqual(r, { entries: 0, jobs: 0, jds: 0, total: 0 });
});

test("the status door reads and never writes", () => {
  const getBody = src.slice(src.indexOf("export async function GET"), src.indexOf("// Clear all artifacts"));
  assert.doesNotMatch(getBody, /resetSim|beginSimRun|endSimRun|renewSimRun/, "a status read that claimed or purged would be a trap");
  assert.match(getBody, /await currentWorkspace\(\)/, "and it answers about the CALLER's tenant, never the default");
});
