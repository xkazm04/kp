// A recruiter route reads a SHARED corpus role's lifecycle as the CALLER's team sees it.
//
// The per-team overlay (job_workspace_state, app/_lib/db/jobs.ts) made "closed", the
// hire target and the posting languages of a seeded corpus role facts about ONE team.
// Its reads take the team as a parameter and, with none named, fold to the role's
// FILING team (the default workspace) - right for the public apply doors, whose
// applicants file there, and wrong for every recruiter door: a team that closed a
// corpus role still saw it live on the job page, in the palette and through the sim
// intake, and the translations tab offered another team's posting languages.
//
// These cases drive the real handlers under two sessions (team A, team B) against one
// corpus role that only B has closed. The public apply door is driven under B's
// session too, to pin that it stays on the filing team whoever is signed in.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `currentWorkspace()` is a read of the session cookie, so the jar is driven from here.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpLifecycleTeamCookie?: () => string | null }).__kpLifecycleTeamCookie = () => cookieValue;
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
            const value = globalThis.__kpLifecycleTeamCookie();
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

// Open mode (no KP_OPERATOR_PASSWORD): what is under test is the TEAM a read resolves.
process.env.KP_SECRET = "job-lifecycle-caller-team-secret";

const { GET: getJobRoute } = await import("./[id]/route.ts");
const { GET: getTranslations } = await import("./[id]/translations/route.ts");
const { GET: getPalettePreview } = await import("../palette/preview/route.ts");
const { POST: postSimApplyCv } = await import("../sim/apply-cv/route.ts");
const { POST: postApplySession } = await import("../apply/[id]/session/route.ts");
const { ensureDb } = await import("../../_lib/db/core.ts");
const { closeRoleIfOpen, setRoleOpenConfig } = await import("../../_lib/db/jobs.ts");
const { createWorkspace, DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const teamA = createWorkspace("Lifecycle team A", "org-lifecycle-a");
const teamB = createWorkspace("Lifecycle team B", "org-lifecycle-b");
const as = (ws: string) => {
  cookieValue = signSession(ws, Date.now());
};

/** A shared corpus row as the seed leaves one: workspace_id NULL, status NULL (live). */
function seedCorpus(id: string): void {
  ensureDb()
    .prepare(
      `INSERT INTO jobs (id, title, payload_json, status, workspace_id, published_at, created_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?)`
    )
    .run(id, id, JSON.stringify({ id, title: id, company: "Corpus Co" }), new Date().toISOString());
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://localhost${url}`) as unknown as NextRequest;

const CLOSED_BY_B = "lt-closed-by-b";
seedCorpus(CLOSED_BY_B);
assert.equal(closeRoleIfOpen(CLOSED_BY_B, teamB.id), true, "fixture: team B retires the corpus role for itself");

test("GET /api/jobs/[id] decorates the role with the caller's lifecycle", async () => {
  as(teamB.id);
  const b = (await (await getJobRoute(get(`/api/jobs/${CLOSED_BY_B}`), params(CLOSED_BY_B))).json()) as { job: { status: unknown } };
  assert.equal(b.job.status, "closed", "team B closed it, so team B's job page reads closed");
  as(teamA.id);
  const a = (await (await getJobRoute(get(`/api/jobs/${CLOSED_BY_B}`), params(CLOSED_BY_B))).json()) as { job: { status: unknown } };
  assert.equal(a.job.status ?? null, null, "team A never closed it, so it is still live for A");
});

test("the command palette's job preview states the caller's lifecycle", async () => {
  const url = `/api/palette/preview?type=job&id=${CLOSED_BY_B}`;
  as(teamB.id);
  const b = (await (await getPalettePreview(get(url))).json()) as { preview: { view: string; status?: unknown } };
  assert.equal(b.preview.view, "job");
  assert.equal(b.preview.status, "closed");
  as(teamA.id);
  const a = (await (await getPalettePreview(get(url))).json()) as { preview: { view: string; status?: unknown } };
  assert.equal(a.preview.view, "job");
  assert.equal(a.preview.status ?? null, null);
});

test("the sim CV intake refuses a role the CALLER closed, and only that caller", async () => {
  const form = () => {
    const fd = new FormData();
    // Not a CV type: an OPEN role gets past the lifecycle gate and is refused by the
    // upload validation instead, before any extractor spawns.
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    fd.set("jobId", CLOSED_BY_B);
    return new Request("http://localhost/api/sim/apply-cv", {
      method: "POST",
      body: fd,
      headers: { "x-forwarded-for": "10.9.7.1" },
    }) as unknown as NextRequest;
  };
  as(teamB.id);
  const b = await postSimApplyCv(form());
  assert.equal(b.status, 410, "team B's intake refuses the role B closed");
  assert.equal(((await b.json()) as { code?: string }).code, "SIM_ROLE_CLOSED");
  as(teamA.id);
  const a = await postSimApplyCv(form());
  assert.notEqual(a.status, 410, "team A's intake still accepts the role (the file is what it refuses)");
});

test("GET /api/jobs/[id]/translations offers the caller's posting languages", async () => {
  const id = "lt-translations";
  seedCorpus(id);
  setRoleOpenConfig(id, { postingLangs: ["cs", "de"] }, teamB.id);
  as(teamB.id);
  const b = (await (await getTranslations(get(`/api/jobs/${id}/translations`), params(id))).json()) as { langs: string[] };
  assert.deepEqual(b.langs, ["cs", "de"], "team B opened the role in cs + de");
  as(teamA.id);
  const a = (await (await getTranslations(get(`/api/jobs/${id}/translations`), params(id))).json()) as { langs: string[] };
  assert.deepEqual(a.langs, [], "team A never opened it, so it has no posting languages of its own");
});

test("the public apply door stays on the FILING team, whoever is signed in", async () => {
  const id = "lt-public";
  seedCorpus(id);
  closeRoleIfOpen(id, teamB.id);
  const open = (sessionId: string) =>
    postApplySession(
      new Request(`http://localhost/api/apply/${id}/session`, {
        method: "POST",
        body: JSON.stringify({ sessionId, flow: "quick" }),
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.7.2" },
      }) as unknown as NextRequest,
      params(id)
    );
  as(teamB.id);
  const res = await open("lt-public-session-1");
  assert.equal(res.status, 200, "B's close is B's: the public door reads the filing team, for whom the role is live");
  const row = ensureDb().prepare(`SELECT workspace_id FROM apply_sessions WHERE id = ?`).get("lt-public-session-1") as
    | { workspace_id: string }
    | undefined;
  assert.equal(row?.workspace_id, DEFAULT_WORKSPACE_ID, "the applicant files into the filing team, not the signed-in one");
  closeRoleIfOpen(id, DEFAULT_WORKSPACE_ID);
  const closed = await open("lt-public-session-2");
  assert.equal(closed.status, 410, "the filing team's own close is what shuts the public door");
});
