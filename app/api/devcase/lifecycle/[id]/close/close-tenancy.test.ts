// D5 — tenant scope for the dev-case close-out, proven BEHAVIORALLY through the real
// route handler (not a source grep).
//
// The defect: the route re-derived its postings with a bare `listPostings()`, i.e. the
// DEFAULT workspace, then filtered in JS by the lifecycle's caseId. For any team other
// than the default one that match set was always empty, so closing their case notified
// nobody, closed no posting — and still answered `{ ok: true, notified: 0 }`. A SQL-text
// guard cannot catch that: every statement involved was already workspace-parameterised;
// the route just passed the wrong workspace.
//
// This test drives POST() directly. It is genuinely route-level because the close route
// takes its tenant from the LIFECYCLE (a by-id read), not from the session — so no cookie
// mocking is needed. (The session-derived routes — lifecycle GET/POST, control, postings,
// outcomes — cannot be driven this way: currentWorkspace() reads cookies(), which throws
// outside a request and falls back to the default workspace, and module mocking needs a
// runner flag `npm run test:unit` does not pass. Their behavioral proof therefore sits at
// the next real seam, the store, in app/_lib/dev-outcomes-tenancy.test.ts, plus the
// argument-threading source guard below.)
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { createLifecycle, saveDevCase, createPosting, createSubmission, updateLifecycle, getLifecycle, getPosting, listOutbox } =
  await import("../../../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../../../_lib/db/workspaces.ts");
const { POST } = await import("./route.ts");
const { NextResponse } = await import("next/server");

after(() => cleanupUnitDb());

// THE TENANT THESE TWO BEHAVIORAL TESTS RUN AS (/perfect 2026-09-02, api-devcase-1).
//
// They used to build the whole chain in a NON-default workspace, because the defect they
// were written for was the route re-deriving postings with a bare `listPostings()`. The
// route now ALSO refuses a caller whose workspace is not the lifecycle's (the shared
// owner guard in app/api/devcase/devcase-owned-lifecycle.ts), and a handler driven
// directly here has no cookie jar, so `currentWorkspace()` falls back to the default
// workspace for every call this file can make. A non-default chain is therefore now a
// 404 — correctly — and could no longer exercise the close at all.
//
// So the close BEHAVIOUR (postings actually closed, wrap-up notes filed in the right
// outbox, an honest no-postings report) is proven here in the default workspace, the
// cross-tenant REFUSAL is proven behaviorally in
// app/api/devcase/devcase-lifecycle-tenancy.test.ts, and the argument-threading that the
// old non-default chain proved — `listPostings(lc.workspaceId)`, never a bare call — is
// pinned by the source guard at the end of this file, the same instrument the
// session-derived siblings below already rely on.
const WS = DEFAULT_WORKSPACE_ID;

// ENVIRONMENT NOTE. Inside a git worktree the node_modules junction breaks next/server's
// dual-module identity under the bare `node --test` runner, so `NextResponse` resolves to
// undefined and ANY handler's `NextResponse.json(...)` throws while building its reply.
// Every DB side effect of this route happens BEFORE that return, so the store assertions —
// which are the actual proof of the tenancy fix — run either way; only the response-payload
// assertions are gated. In a normal checkout NextResponse loads and both halves run.
const RESPONSE_OK = typeof NextResponse !== "undefined";
type CloseBody = { ok?: boolean; notified?: number; notifyFailures?: number; postingsClosed?: number; noPostings?: boolean };

async function close(id: string): Promise<CloseBody | null> {
  try {
    const res = await POST(new Request("http://localhost/api/devcase/lifecycle/x/close", { method: "POST" }), {
      params: Promise.resolve({ id }),
    });
    return (await res.json()) as CloseBody;
  } catch (err) {
    if (RESPONSE_OK) throw err; // a real failure, not the worktree shim
    return null;
  }
}

test("closing a lifecycle actually closes its postings and notifies its submitters", async () => {
  // A whole case → posting → submission chain. Each child inherits its parent's workspace,
  // so the enumeration below runs against exactly the tenant the lifecycle names.
  const lc = createLifecycle({ title: "Backend engineer" }, false, "en", WS);
  const devCase = saveDevCase(
    { need: { title: "Backend engineer" }, analysis: {}, role: { title: "Backend engineer" }, case: { title: "Cache invalidation" } },
    WS
  );
  const posting = createPosting({
    caseId: devCase.id,
    channel: "direct",
    token: "tok-close-alpha",
    roleTitle: "Backend engineer",
    caseTitle: "Cache invalidation",
  });
  assert.equal(posting.status, "open");
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: "Dana",
    repoRef: "https://example.test/dana",
    contact: "dana@example.test",
  });
  updateLifecycle(lc.id, { caseId: devCase.id, postingId: posting.id, stage: "promoted" });

  const body = await close(lc.id);

  // Store effects — pre-fix NONE of these happened for a non-default team.
  assert.equal(getPosting(posting.id)?.status, "closed", "the team's posting is actually closed");
  assert.equal(getLifecycle(lc.id)?.stage, "closed");
  assert.match(getLifecycle(lc.id)?.detail ?? "", /1 candidate\(s\) notified/, "the close counted the real notification");
  // The wrap-up note landed in the LIFECYCLE's outbox — filed under `lc.workspaceId`,
  // which is what makes it resendable by the team whose case was closed.
  assert.ok(
    listOutbox(20, WS).some((m) => m.ref === submission.id && m.kind === "rejection"),
    "wrap-up note is in the lifecycle's own outbox"
  );

  if (body) {
    // Pre-fix this was { ok: true, notified: 0, postingsClosed: 0 } — a silent no-op.
    assert.equal(body.ok, true);
    assert.equal(body.postingsClosed, 1);
    assert.equal(body.notified, 1);
    assert.equal(body.noPostings, false);
  }
});

test("a close that finds no postings reports that honestly instead of a bare ok/notified:0", async () => {
  // Legitimate state: a lifecycle closed before it ever published. The close DID happen
  // (the stage flip is committed), so this stays a 200 — but the payload and the audit
  // trail must distinguish it from a real close, which the old response could not do.
  const lc = createLifecycle({ title: "Never published" }, false, "en", WS);
  const body = await close(lc.id);
  assert.equal(getLifecycle(lc.id)?.stage, "closed");
  assert.match(getLifecycle(lc.id)?.detail ?? "", /no open postings were found/, "the human-facing detail says so");
  if (body) {
    assert.equal(body.noPostings, true, "the response must say no postings were found");
    assert.equal(body.postingsClosed, 0);
    assert.equal(body.notified, 0);
  }
});

// Source guard for the session-derived siblings, which cannot be driven behaviorally here
// (see the header). A bare call falls to DEFAULT_WORKSPACE_ID — the whole defect.
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(path.join(apiDir, p), "utf8");
// Only the CODE, so a prose mention of the old bare call in a comment can't trip the
// "no bare call remains" assertions below.
const code = (p: string) => read(p).replace(/\/\/[^\n]*/g, "");

// The half of the original defect a default-workspace behavioral test can no longer see:
// with `WS === DEFAULT_WORKSPACE_ID` a bare `listPostings()` and `listPostings(lc.workspaceId)`
// return the same rows, so only the source can say which one the route calls.
test("the close route enumerates postings in the LIFECYCLE's workspace, never the default one", () => {
  const close = code("lifecycle/[id]/close/route.ts");
  assert.match(close, /listPostings\(lc\.workspaceId\)/, "postings must be enumerated in the lifecycle's tenant");
  assert.doesNotMatch(close, /listPostings\(\)/, "no bare listPostings() may remain");
  assert.match(close, /listSubmissions\(posting\.id, lc\.workspaceId\)/, "submissions too");
  assert.match(close, /workspaceId: lc\.workspaceId/, "and the wrap-up note files into that same tenant");
});

test("the session-derived dev-studio routes resolve currentWorkspace() and thread it into every scoped call", () => {
  const lifecycle = code("lifecycle/route.ts");
  assert.match(lifecycle, /currentWorkspace\(\)/);
  assert.match(lifecycle, /listLifecycles\([^)]*currentWorkspace\(\)[^)]*\)/, "lifecycle GET must scope listLifecycles");
  // The POST resolves the tenant ONCE into `workspace` and passes that to the
  // metering gate, createLifecycle and the runner task alike. Accept either the
  // inline call or that variable: pinning the inline form would have forced a
  // third redundant `await currentWorkspace()` in one handler, and the sibling
  // assertions below already read the variable form (`listPostings(ws)`).
  assert.match(lifecycle, /const workspace = await currentWorkspace\(\)/, "the POST resolves the tenant once");
  assert.match(lifecycle, /createLifecycle\([^)]*(currentWorkspace\(\)|workspace)[^)]*\)/, "lifecycle POST must scope createLifecycle");
  // The runner task must carry it too — the row was created for this team while
  // its task ran as the default one, so progress surfaced in the wrong tray.
  assert.match(lifecycle, /startTask\("lifecycle",[^)]*,\s*workspace\s*\)/, "the lifecycle runner task must be scoped");
  assert.doesNotMatch(lifecycle, /listLifecycles\(\)/, "no bare listLifecycles() may remain");

  const control = code("control/route.ts");
  assert.match(control, /currentWorkspace\(\)/);
  // The tenant stays the FIRST argument; the sweep also takes the client key now that
  // each resumed lifecycle spends a slot of the agent task budget (wave 18b), so the
  // trailing arguments are open — what this pins is the workspace, not the arity.
  assert.match(control, /reconcile\(\s*await currentWorkspace\(\)\s*(,[^)]*)?\)/, "reconcile must sweep the caller's workspace");
  assert.doesNotMatch(control, /listLifecycles\(\)/, "the control room's GET must be workspace-scoped");
  // The reconcile sweep spawns runners: both the dedupe probe and the task must
  // use the workspace being swept, or it checks the default team and duplicates.
  assert.match(control, /getActiveTaskByDedupe\([^)]*,\s*workspaceId\s*\)/, "the dedupe probe must be scoped");
  assert.match(control, /startTask\("lifecycle",[^)]*,\s*workspaceId\s*\)/, "the resumed runner must be scoped");

  const postings = code("postings/route.ts");
  assert.match(postings, /listPostings\(\s*ws\s*\)/);
  assert.match(postings, /listSubmissions\([^)]*\bws\b[^)]*\)/);
  // (the refs argument is itself a nested call, so match the trailing workspace argument)
  assert.match(postings, /latestOutcomeByRefs\([\s\S]*?,\s*ws\s*\)/);
  assert.doesNotMatch(postings, /listPostings\(\)/, "no bare listPostings() may remain");

  const outcomes = code("outcomes/route.ts");
  assert.match(outcomes, /listOutcomes\([^)]*\bws\b[^)]*\)/);
  assert.match(outcomes, /calibrate\([\s\S]*?,\s*ws\s*\)/);
  assert.match(outcomes, /recordOutcome\([^)]*\bws\b[^)]*\)/);
  assert.doesNotMatch(outcomes, /listOutcomes\(\)/, "no bare listOutcomes() may remain");
});
