// PATCH /api/pipeline/stage-sla — the ONE narrow writer of a team's stage aging
// cadence (challenge-r03 pipeline-board-ui/A).
//
// The cadence used to be per-browser localStorage; it is now `slaDays` on the
// workspace's `pipelineStages` axis, which the board, the sidebar badge and the
// automation pass all read. This route edits exactly one column's value under the
// store's IMMEDIATE read-modify-write (updateDecisionConfig re-reads the effective
// axis inside the lock), so it cannot clobber a concurrent Settings -> Hiring save,
// and it asks the seat for `pipeline:write` like every other axis write.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `cookies()` cannot run outside a Next request scope; resolve `next/headers` to a
// virtual module whose session jar this file drives (the channels-doors-gate shape).
const VIRTUAL_HEADERS = "kp-test:next-headers-stage-sla";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpSlaTestCookie?: () => string | null }).__kpSlaTestCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpSlaTestCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// A password, so the seat's role decides authority (open dev mode folds everyone to owner).
process.env.KP_SECRET = "stage-sla-test-secret";
process.env.KP_OPERATOR_PASSWORD = "stage-sla-test-password";

const { PATCH } = await import("./route.ts");
const { getPipelineAxis } = await import("../../../_lib/pipeline-axis-server.ts");
const { getDecisionConfig, setDecisionConfig } = await import("../../../_lib/decision-config-store.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const recruiter = createUser({ orgId: ORG, email: "sla.rec@csas.cz", name: "Sla Rec", status: "active", password: "rec-pw-12345" });
const viewer = createUser({ orgId: ORG, email: "sla.view@csas.cz", name: "Sla View", status: "active", password: "view-pw-12345" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer");

function signedInAs(user: { id: string; orgId: string }): void {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/pipeline/stage-sla", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest
  );
const codeOf = async (r: Response) => ((await r.json()) as { code?: string }).code;

const OTHER_WS = "team-stage-sla-other";
const stored = () => JSON.stringify(getDecisionConfig("pipelineStages", DEFAULT_WORKSPACE));
/** The axis with every slaDays key removed — what must stay byte-identical. */
const shape = (ws: string) => {
  const a = getPipelineAxis(ws);
  const strip = (s: Record<string, unknown>) => {
    const rest = { ...s };
    delete rest.slaDays;
    return rest;
  };
  return JSON.stringify({ stages: a.stages.map(strip), retired: a.retired.map(strip) });
};

before(() => {
  // A composed axis with a retired tombstone and a customised column, so "every other
  // stage byte-identical" is a claim about more than the shipped five.
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Accepted", label: "Applied", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening", actions: ["screen"] },
        { id: "Interview", label: "Interview", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
      retired: [{ id: "Old", label: "Old column", role: "custom" }],
    },
    DEFAULT_WORKSPACE,
    "team"
  );
  signedInAs(recruiter);
});

test("PATCH sets one column's cadence on the team axis and touches nothing else", async () => {
  const shapeBefore = shape(DEFAULT_WORKSPACE);
  const otherBefore = JSON.stringify(getPipelineAxis(OTHER_WS));
  const res = await patch({ stage: "Screened", days: 3 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; stages: { id: string; slaDays?: number }[] };
  assert.equal(body.ok, true);
  assert.equal(body.stages.find((s) => s.id === "Screened")?.slaDays, 3, "the response carries the axis the board should render");
  assert.equal(getPipelineAxis(DEFAULT_WORKSPACE).stages.find((s) => s.id === "Screened")?.slaDays, 3);
  assert.equal(shape(DEFAULT_WORKSPACE), shapeBefore, "ids, labels, roles, actions and the retired list are unchanged");
  assert.equal(JSON.stringify(getPipelineAxis(OTHER_WS)), otherBefore, "another team's axis is untouched");
});

test("PATCH with days:null removes the key (back to the role default)", async () => {
  await patch({ stage: "Interview", days: 2 });
  const res = await patch({ stage: "Interview", days: null });
  assert.equal(res.status, 200);
  const interview = getPipelineAxis(DEFAULT_WORKSPACE).stages.find((s) => s.id === "Interview")!;
  assert.equal("slaDays" in interview, false);
});

test("an off-axis stage, the terminal stage or an out-of-range value is refused and nothing is written", async () => {
  const before = stored();
  for (const body of [
    { stage: "Nowhere", days: 3 },
    { stage: "Old", days: 3 },
    { stage: "Hired", days: 3 },
    { stage: "Screened", days: 0 },
    { stage: "Screened", days: 366 },
    { stage: "Screened", days: 2.5 },
    { stage: "Screened", days: "3" },
    { stage: 7, days: 3 },
    {},
  ]) {
    const res = await patch(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(await codeOf(res), "DECISION_CONFIG_INVALID", JSON.stringify(body));
  }
  assert.equal(stored(), before, "a refused write leaves the stored axis byte-identical");
});

test("a seat without pipeline:write is refused with FORBIDDEN_CAPABILITY and nothing is written", async () => {
  const before = stored();
  signedInAs(viewer);
  try {
    const res = await patch({ stage: "Screened", days: 9 });
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), "FORBIDDEN_CAPABILITY");
  } finally {
    signedInAs(recruiter);
  }
  assert.equal(stored(), before);
});
