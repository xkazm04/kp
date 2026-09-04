// The two saved-analysis doors. Between them they serve every analyzed candidate's
// summary row and one candidate's whole CV payload, and they record the recruiter's
// advance/hold/pass — which is echoed onto that candidate's pipeline entries as a
// decision event. All of it was:
//
//   • UNGATED beyond middleware's session presence. `route-capability-coverage.test.ts`
//     carried `analyses/[slug]/route.ts` as an unjudged "slice 2 candidate", so a
//     `viewer` seat could decide on a candidate exactly as well as an owner.
//   • Answering hand-written ENGLISH SENTENCES with no code — "Analysis not found.",
//     "Failed to load analyses." — which History and the report render straight out of
//     `body.error`. A Czech recruiter read them in English at every locale. (Not on the
//     error-response-contract ceiling: these never forwarded a THROWN message, they
//     invented their own prose, which the ratchet does not scan for.)
//   • Hard-capped at 200 rows with nothing saying so — a workspace past 200 analyses
//     lost the tail behind a complete-looking list.
//
// Drives the REAL handlers on a throwaway SQLite file. unit-db.ts must stay the FIRST
// project import. Run: node scripts/run-unit-tests.mjs "app/api/analyses/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so `cookies()` throws and the
// auth helpers degrade. These tests are ABOUT the authority decision, so resolve
// `next/headers` to a virtual module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpAnalysesTestCookie?: () => string | null }).__kpAnalysesTestCookie = () => cookieValue;
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
            const value = globalThis.__kpAnalysesTestCookie();
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

// A signing secret AND an operator password: without the password every caller folds to
// owner (open dev mode) and there is no authority decision left to prove.
process.env.KP_SECRET = "analyses-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "analyses-route-test-password";

const { GET: listRoute } = await import("./route.ts");
const { GET: readRoute, PATCH: patchRoute } = await import("./[slug]/route.ts");
const { saveAnalysis } = await import("../../_lib/db/analyses.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const recruiter = createUser({ orgId: ORG, email: "an.recruiter@csas.cz", name: "Rec", status: "active", password: "rec-pw-1234" });
const viewer = createUser({ orgId: ORG, email: "an.viewer@csas.cz", name: "View", status: "active", password: "view-pw-1234" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer");

function seat(user: { id: string; orgId: string } | null) {
  cookieValue = user === null ? null : signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

const PAYLOAD = { metadata: { analysisEngine: "gemini", textExtractor: "gemini", engineKind: "llm", engineProvider: "gemini" } };

function seed(label: string, engineKind: string | null) {
  return saveAnalysis({
    candidateLabel: label,
    jdSlug: null,
    score: 71,
    roleFamily: "backend",
    seniority: "senior",
    payload: engineKind
      ? { metadata: { ...PAYLOAD.metadata, engineKind, engineProvider: engineKind === "llm" ? "gemini" : null } }
      : { metadata: { analysisEngine: "legacy", textExtractor: "legacy" } },
  }).slug;
}

const llmSlug = seed("Ada Lovelace", "llm");
const detSlug = seed("Grace Hopper", "deterministic");

const listUrl = (qs = "") => new Request(`http://localhost/api/analyses${qs}`);
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

// ---- authority --------------------------------------------------------------

test("an unseated caller is refused on every door", async () => {
  seat(null);
  assert.equal((await listRoute(listUrl())).status, 401);
  assert.equal((await readRoute(new Request("http://localhost/x"), slugCtx(llmSlug))).status, 401);
  const patch = await patchRoute(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ disposition: "advance" }) }),
    slugCtx(llmSlug)
  );
  assert.equal(patch.status, 401);
});

test("a VIEWER may read an analysis but may not decide on it", async () => {
  seat(viewer);
  // Reading is what a viewer seat is for; `read` is the capability every seated role holds.
  assert.equal((await readRoute(new Request("http://localhost/x"), slugCtx(llmSlug))).status, 200);
  assert.equal((await listRoute(listUrl())).status, 200);
  // Deciding is not. PATCH echoes the disposition onto the candidate's pipeline entries as
  // a decision event — a recruiter operation, which is exactly what pipeline:write names.
  const res = await patchRoute(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ disposition: "pass", note: "no" }) }),
    slugCtx(llmSlug)
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string; capability?: string; error?: string };
  // A CODE, not the bare `{ error: "Forbidden" }` the raw gate answers — the one string
  // the client is never allowed to render.
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "pipeline:write");
});

test("a RECRUITER may decide", async () => {
  seat(recruiter);
  const res = await patchRoute(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ disposition: "advance", note: "strong" }) }),
    slugCtx(llmSlug)
  );
  assert.equal(res.status, 200, "non-vacuity: the gate refuses the seat, not the request shape");
  assert.deepEqual(await res.json(), { ok: true });
});

// ---- coded answers ----------------------------------------------------------

test("an unknown slug is a CODED 404 on both verbs, never an English sentence", async () => {
  seat(recruiter);
  const read = await readRoute(new Request("http://localhost/x"), slugCtx("no-such-analysis"));
  assert.equal(read.status, 404);
  assert.equal(((await read.json()) as { code?: string }).code, "ANALYSIS_NOT_FOUND");
  const patch = await patchRoute(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ disposition: "hold" }) }),
    slugCtx("no-such-analysis")
  );
  assert.equal(patch.status, 404);
  assert.equal(((await patch.json()) as { code?: string }).code, "ANALYSIS_NOT_FOUND");
});

test("a malformed GitHub attachment is refused BY CODE", async () => {
  seat(recruiter);
  const res = await patchRoute(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ githubAnalysis: { nope: true } }) }),
    slugCtx(llmSlug)
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "ANALYSIS_GITHUB_INVALID");
});

// ---- the projection ---------------------------------------------------------

test("the read projection says WHICH ENGINE produced the analysis", async () => {
  seat(recruiter);
  const llm = (await (await readRoute(new Request("http://localhost/x"), slugCtx(llmSlug))).json()) as Record<string, unknown>;
  assert.equal(llm.engine, "llm");
  assert.equal(llm.engineProvider, "gemini");
  const det = (await (await readRoute(new Request("http://localhost/x"), slugCtx(detSlug))).json()) as Record<string, unknown>;
  assert.equal(det.engine, "deterministic");
  assert.equal(det.engineProvider, null, "a deterministic result has no provider to name");
  // Still a PROJECTION, not the row: the snake_case store columns never reach the wire.
  assert.equal(Object.keys(llm).some((k) => k.includes("_")), false, `store column leaked: ${Object.keys(llm).join(", ")}`);
});

// ---- the bound ---------------------------------------------------------------

test("the list takes a clamped limit and reports when it bit", async () => {
  seat(recruiter);
  const one = (await (await listRoute(listUrl("?limit=1"))).json()) as { analyses: unknown[]; limit: number; truncated: boolean };
  assert.equal(one.limit, 1);
  assert.equal(one.analyses.length, 1);
  assert.equal(one.truncated, true, "a full page must SAY it is a page, or History claims a complete list");

  const roomy = (await (await listRoute(listUrl("?limit=400"))).json()) as { limit: number; truncated: boolean; analyses: unknown[] };
  assert.equal(roomy.limit, 400);
  assert.equal(roomy.truncated, false);
  assert.ok(roomy.analyses.length >= 2);

  // Clamped, never refused: this read's caller is a tab refresh, and a 400 over a typo in
  // a URL would replace the list with an error box.
  for (const [qs, expected] of [["", 200], ["?limit=", 200], ["?limit=abc", 200], ["?limit=0", 1], ["?limit=-5", 1], ["?limit=99999", 500], ["?limit=2.7", 2]] as const) {
    const body = (await (await listRoute(listUrl(qs))).json()) as { limit: number };
    assert.equal(body.limit, expected, `limit "${qs}" should clamp to ${expected}`);
  }
});
