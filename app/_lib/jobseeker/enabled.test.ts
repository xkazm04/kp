// The job-seeker module's install switch (enabled.ts) and the door that enforces it
// (proxy.ts, step 00).
//
// Pinned: KP_JOBSEEKER=1 and nothing else turns the module on; the path predicate
// catches /me and /api/jobseeker by whole segment only; the scan clock job is not
// offered while the module is off; and the REAL proxy answers a hidden module path
// exactly as it answers a path no route owns — after the same auth gate, rewritten to
// an address nothing answers — while an enabled module passes through untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isJobseekerPath, jobseekerEnabled, schedulerJobOffered, UNKNOWN_ROUTE_PATH } from "./enabled.ts";
import { SCHEDULER_JOB_NAMES } from "../scheduler-jobs.ts";

test("the module is on only for KP_JOBSEEKER=1 exactly", () => {
  assert.equal(jobseekerEnabled({ KP_JOBSEEKER: "1" }), true);
  for (const value of [undefined, "", "0", "true", "yes", "on", " 1", "1 ", "TRUE"]) {
    assert.equal(jobseekerEnabled({ KP_JOBSEEKER: value }), false, `KP_JOBSEEKER=${JSON.stringify(value)} is off`);
  }
  assert.equal(jobseekerEnabled({}), false, "unset is off");
});

test("the module's paths are /me and /api/jobseeker, by whole segment", () => {
  for (const p of ["/me", "/me/", "/me/jobs", "/me/jobs/abc", "/me/cv/print", "/me/scans", "/api/jobseeker", "/api/jobseeker/profile", "/api/jobseeker/cv.pdf"]) {
    assert.equal(isJobseekerPath(p), true, p);
  }
  for (const p of ["/", "/media", "/members", "/meet", "/api/me/capabilities", "/api/me/onboarding", "/api/jobseekers", "/api/jobseeker-x", "/login", "/home/me"]) {
    assert.equal(isJobseekerPath(p), false, p);
  }
});

test("the seeker's scan is the only scheduler job the switch withholds", () => {
  for (const name of SCHEDULER_JOB_NAMES) {
    assert.equal(schedulerJobOffered(name, { KP_JOBSEEKER: "1" }), true, `${name} is offered with the module on`);
    assert.equal(schedulerJobOffered(name, {}), name !== "jobseeker_scan", `${name} with the module off`);
  }
});

test("the unknown-route address sits under a private (_-prefixed) folder, which the App Router never routes", () => {
  assert.match(UNKNOWN_ROUTE_PATH, /^\/_[a-z]/);
});

// ── the gate, through the real proxy ──────────────────────────────────────────────
// "next/server.js" with the extension, as app/shell-headers.test.ts explains: node's
// resolver needs it for the NextRequest that carries `nextUrl`.
const { proxy, config } = await import("../../../proxy.ts");
const { NextRequest } = await import("next/server.js");

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await run();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const call = (path: string) => proxy(new NextRequest(`https://kp.test${path}`));
const rewrittenTo = (res: Response) => {
  const to = res.headers.get("x-middleware-rewrite");
  return to ? new URL(to).pathname : null;
};
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1" && rewrittenTo(res) === null;

// Open dev mode: no operator password, so the auth gate is not in play.
const OPEN = { KP_OPERATOR_PASSWORD: undefined, KP_ALLOW_OPEN: undefined };

test("OFF: every module path is rewritten to the address no route owns, with the policy an unknown path gets", async () => {
  await withEnv({ ...OPEN, KP_JOBSEEKER: undefined }, async () => {
    for (const path of ["/me", "/me/jobs", "/me/jobs/abc?open=1", "/me/cv/print", "/api/jobseeker/profile", "/api/jobseeker/postings/x/deepdive"]) {
      const res = await call(path);
      assert.equal(rewrittenTo(res), UNKNOWN_ROUTE_PATH, `${path} is hidden`);
      assert.ok(res.headers.get("Content-Security-Policy-Report-Only"), `${path} still carries the CSP an unknown route gets`);
    }
    // And a path no route owns is simply forwarded — the 404 is Next's own, for both.
    const unknown = await call("/nothing-here");
    assert.equal(passedThrough(unknown), true);
    assert.ok(unknown.headers.get("Content-Security-Policy-Report-Only"));
  });
});

test("OFF: a dotted module path (reached only via the extra matcher entries) is hidden with no CSP, like an unmatched path", async () => {
  await withEnv({ ...OPEN, KP_JOBSEEKER: undefined }, async () => {
    for (const path of ["/api/jobseeker/cv.pdf", "/api/jobseeker/cv.md"]) {
      const res = await call(path);
      assert.equal(rewrittenTo(res), UNKNOWN_ROUTE_PATH, path);
      assert.equal(res.headers.get("Content-Security-Policy-Report-Only"), null, `${path}: the first matcher never sees a dotted path, so no CSP`);
    }
  });
});

test("ON: module paths pass through exactly as before", async () => {
  await withEnv({ ...OPEN, KP_JOBSEEKER: "1" }, async () => {
    for (const path of ["/me", "/me/jobs", "/api/jobseeker/profile"]) {
      const res = await call(path);
      assert.equal(passedThrough(res), true, `${path} is forwarded`);
      assert.ok(res.headers.get("Content-Security-Policy-Report-Only"));
    }
    // Dotted: untouched — no CSP, no rewrite — which is what they got when the proxy
    // never ran for them.
    const pdf = await call("/api/jobseeker/cv.pdf");
    assert.equal(passedThrough(pdf), true);
    assert.equal(pdf.headers.get("Content-Security-Policy-Report-Only"), null);
  });
});

test("OFF in password mode: a signed-out visitor meets the same auth answer an unknown path gets", async () => {
  await withEnv({ KP_OPERATOR_PASSWORD: "pw", KP_SECRET: "unit-secret-lote", KP_JOBSEEKER: undefined }, async () => {
    const page = await call("/me/jobs");
    const unknownPage = await call("/nothing-here");
    assert.equal(page.status, unknownPage.status);
    assert.equal(new URL(page.headers.get("location")!).pathname, "/login");
    assert.equal(new URL(page.headers.get("location")!).searchParams.get("next"), "/me/jobs");

    const api = await call("/api/jobseeker/profile");
    const unknownApi = await call("/api/nothing-here");
    assert.equal(api.status, 401);
    assert.equal(api.status, unknownApi.status);
    assert.deepEqual(await api.json(), await unknownApi.json());
  });
});

test("the matcher adds the two module prefixes beside the catch-all, which skips dotted paths", () => {
  assert.ok(config.matcher.includes("/me/:path*"));
  assert.ok(config.matcher.includes("/api/jobseeker/:path*"));
  assert.equal(config.matcher.length, 3);
});
