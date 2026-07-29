// Tenant scope for the automation run log (scheduler-tenancy-phase1). The policy
// pass is a deliberate GLOBAL sweep, so one scheduler_runs row spans every team —
// but its decisions_json carries per-entry candidate labels and rejection reasons.
// Before this, listRuns() handed every reader the whole cross-tenant list, and
// /api/automation/schedule shipped it straight to any operator's browser. These
// tests pin the read boundary against an ISOLATED throwaway DB (unit-db.ts stays
// the first project import), plus a source guard that the two routes actually
// resolve currentWorkspace() and thread it into the reads.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decisionsForWorkspace, ensureSchedule, listRuns, recordRun } from "./scheduler-store.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const JOB = "t_tenancy";
const TEAM_A = "ws_team_a";
const TEAM_B = "ws_team_b";

type Row = { entryId: string; action: string; reason: string; workspaceId?: string };

test("a run log read scoped to one workspace never returns another team's decision rows", () => {
  ensureSchedule(JOB);
  recordRun({
    job: JOB,
    trigger: "manual",
    status: "ok",
    summary: { advanced: 1, rejected: 0, held: 2, alerts: 0, errors: 0, evaluated: 3 },
    decisions: [
      { entryId: "a1", action: "hold", reason: "Would be queued for approval: weak fit", workspaceId: TEAM_A },
      { entryId: "b1", action: "advance", reason: "score 88", workspaceId: TEAM_B },
      { entryId: "b2", action: "hold", reason: "awaiting match score", workspaceId: TEAM_B },
    ],
    startedAt: new Date().toISOString(),
  });

  const asA = listRuns(10, JOB, { workspace: TEAM_A });
  assert.equal(asA.length, 1, "the run row itself is global — the tenant still sees that a pass happened");
  const aRows = asA[0].decisions as Row[];
  assert.deepEqual(
    aRows.map((d) => d.entryId),
    ["a1"],
    "team A sees only its own decision rows"
  );
  assert.equal(asA[0].decisionCount, 1, "decisionCount reports the rows THIS tenant may see");
  assert.equal(asA[0].decisionsWorkspace, TEAM_A);
  // No candidate label / reason from the other team may appear anywhere in the payload.
  assert.doesNotMatch(JSON.stringify(asA[0].decisions), /b1|b2|score 88|awaiting match score/);

  const asB = listRuns(10, JOB, { workspace: TEAM_B });
  assert.deepEqual((asB[0].decisions as Row[]).map((d) => d.entryId), ["b1", "b2"]);
  assert.equal(asB[0].decisionCount, 2);

  // The stored summary stays GLOBAL by design (the pass really did evaluate 3):
  // it is not silently recomputed per tenant — decisionCount is the honest
  // per-tenant figure beside it.
  assert.deepEqual(asA[0].summary, asB[0].summary);
  assert.equal((asA[0].summary as { evaluated: number }).evaluated, 3);
});

test("an unfiltered read is still whole (the operator-global path) and legacy rows belong to the default tenant", () => {
  const legacyJob = "t_tenancy_legacy";
  ensureSchedule(legacyJob);
  recordRun({
    job: legacyJob,
    status: "ok",
    summary: { evaluated: 2 },
    // Rows persisted before automation-pass stamped workspaceId — they predate
    // multi-tenancy, so they are the default workspace's and nobody else's.
    decisions: [{ entryId: "old1", action: "hold", reason: "legacy" }, { entryId: "a9", action: "hold", reason: "x", workspaceId: TEAM_A }],
    startedAt: new Date().toISOString(),
  });

  assert.equal((listRuns(10, legacyJob)[0].decisions as Row[]).length, 2, "no workspace = unfiltered internal read");
  assert.deepEqual(
    (listRuns(10, legacyJob, { workspace: DEFAULT_WORKSPACE_ID })[0].decisions as Row[]).map((d) => d.entryId),
    ["old1"],
    "an unstamped legacy row is attributed to the default workspace"
  );
  assert.deepEqual(
    (listRuns(10, legacyJob, { workspace: TEAM_B })[0].decisions as Row[]).map((d) => d.entryId),
    [],
    "…and is never shown to another tenant"
  );
});

test("a decision payload that is not a list of rows yields nothing to a scoped reader", () => {
  assert.deepEqual(decisionsForWorkspace(null, TEAM_A), null);
  assert.deepEqual(decisionsForWorkspace({ leaked: "shape" }, TEAM_A), []);
  assert.deepEqual(decisionsForWorkspace({ leaked: "shape" }, undefined), { leaked: "shape" });
});

// --- source guards: the request-scoped surfaces must pass a workspace ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(here, p), "utf8");

test("the automation schedule + run routes scope their decision reads to the caller's workspace", () => {
  const schedule = read("../api/automation/schedule/route.ts");
  assert.match(schedule, /currentWorkspace\(\)/, "the schedule route must resolve currentWorkspace()");
  assert.match(schedule, /listRuns\(10,\s*POLICY_JOB,\s*\{\s*workspace\s*\}\)/, "policy runs must be workspace-scoped");
  assert.match(schedule, /listRuns\(5,\s*REMINDERS_JOB,\s*\{\s*workspace\s*\}\)/, "reminder runs must be workspace-scoped");
  assert.doesNotMatch(schedule, /listRuns\(10\)/, "no unscoped listRuns may remain");

  const run = read("../api/automation/run/route.ts");
  assert.match(run, /currentWorkspace\(\)/, "the run route must resolve currentWorkspace()");
  assert.match(run, /decisionsForWorkspace\(decisions,\s*workspace\)/, "the response decisions must be tenant-filtered");
  assert.doesNotMatch(run, /NextResponse\.json\(\{\s*summary,\s*decisions,/, "the raw global decision list must not be returned");
});

// decision-count-honesty. Shipping the labels is only half the fix: for a while
// NOTHING in app/features read workspaceDecisionCount / decisionCount / scheduleScope,
// so a multi-tenant operator saw a GLOBAL "evaluated 40" headline over four of their
// own rows, a run-history badge row that outnumbered its decision list, and a commit
// button that vanished when only OTHER teams had pending changes — even though a
// commit applies the pass installation-wide. These guards pin the consumption, and
// that it stays conditional so a single-tenant install renders exactly as before.
test("the automation UI consumes the tenancy labels the routes ship", () => {
  const modal = read("../features/sub_pipeline/PassPreviewModal.tsx");
  assert.match(modal, /workspaceDecisionCount/, "the preview must read the per-tenant decision count");
  assert.match(modal, /mine !== total/, "the scope line must render ONLY when the tenant's count differs from the run's");
  assert.match(modal, /t\("previewScope"/, "…and say the ratio in localized copy");
  assert.match(modal, /othersOnly/, "the preview must name the only-other-teams-have-changes case");
  assert.match(
    modal,
    /changes > 0 \|\| othersOnly \?/,
    "the commit affordance must survive that case (a commit is installation-wide) instead of being hidden"
  );
  assert.match(modal, /t\("previewApplyGlobal"/, "…relabeled with the global change count so the click can't read as 'apply my 0'");

  const kit = read("../features/simulation/controlCenterKit.ts");
  assert.match(kit, /workspaceDecisionCount/, "the dry-run fetch must forward the label, not drop it");

  const control = read("../features/sub_pipeline/SchedulerControl.tsx");
  assert.match(control, /run\.decisionCount !== run\.summary\.evaluated/, "the run-history caption must be conditional on a real gap");
  assert.match(control, /t\("runScope"/, "…and localized");
  assert.match(control, /scheduleScope === "global"/, "the enable toggle must caption its installation-wide blast radius");
  assert.match(control, /t\("scopeGlobal"\)/, "…in localized copy");
});

test("every catalog carries the tenancy-honesty copy", () => {
  const root = path.resolve(here, "..", "..");
  for (const locale of ["en", "cs", "de", "fr"] as const) {
    const messages = JSON.parse(readFileSync(path.join(root, "messages", `${locale}.json`), "utf8")) as {
      pipeline: { tab: Record<string, string>; scheduler: Record<string, string> };
    };
    for (const key of ["previewScope", "previewOtherTeamsOnly", "previewApplyGlobal"]) {
      assert.ok((messages.pipeline.tab[key]?.length ?? 0) > 0, `${locale}: pipeline.tab.${key} must exist`);
    }
    for (const key of ["runScope", "scopeGlobal", "scopeGlobalTitle"]) {
      assert.ok((messages.pipeline.scheduler[key]?.length ?? 0) > 0, `${locale}: pipeline.scheduler.${key} must exist`);
    }
    assert.match(messages.pipeline.tab.previewScope, /\{mine\}[\s\S]*\{total\}/, `${locale}: previewScope names both figures`);
    assert.match(messages.pipeline.scheduler.runScope, /\{mine\}[\s\S]*\{total\}/, `${locale}: runScope names both figures`);
  }
});

test("the automation degrade switch reads the asking tenant's billing state", () => {
  const enforce = read("./billing/enforce.ts");
  assert.match(
    enforce,
    /export function meterAllows\(meter: Meter, opts: \{ now\?: Date; workspace\?: string \}/,
    "meterAllows must take the same { now, workspace } options shape as meterGate"
  );
  const runFile = read("./automation-run.ts");
  assert.match(runFile, /meterAllows\("ai_candidates",\s*\{\s*workspace:\s*workspaceId\s*\}\)/, "the pass must pass the entry's workspace");
  assert.doesNotMatch(runFile, /meterAllows\("ai_candidates"\)/, "no default-workspace degrade read may remain");
});

test("the pass stamps every decision with its entry's own workspace so the log can be filtered", () => {
  const pass = read("./automation-pass.ts");
  assert.match(pass, /workspaceId\?: string;/, "AutomationDecision must carry the tenant");
  assert.match(pass, /d\.workspaceId = ws/, "executeAutomationPass must stamp it from the entry snapshot");
});
