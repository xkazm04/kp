// FINDING #3 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities):
//
//   The owned-repo list was read from a single per_page=100 page with sort=updated, so
//   a prolific candidate (>100 repos) was silently truncated to their 100 most-recently
//   -updated repos — dropping their oldest, often most-starred/flagship work from every
//   total (stars, forks, language mix, deep-review shortlist). metrics.publicRepos (the
//   true count) then silently disagreed with ownedReposAnalyzed, and the summary read as
//   complete. The route must (a) paginate up to a bounded cap so >100 repos are actually
//   analyzed, and (b) annotate the payload when even that cap is exceeded, so a truncated
//   portfolio is never presented as complete.
//
// A page-aware GitHub mock proves both: an account whose flagship is on page 3 has its
// stars counted (pagination works), and an account past the 300-repo cap gets an explicit
// truncation limitation. Kept in its own file (process-isolated by the runner) so its
// page-aware fetch mock doesn't entangle with route.test.ts's per-path mock.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
// Side-effect import: sets KP_DB_PATH to a throwaway file BEFORE ./route.ts pulls in the
// db layer. Keep it first (ESM evaluates imports in source order).
import "../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";

const realFetch = globalThis.fetch;

// A minimal owned (non-fork) repo the route accepts. Stars default to 0 so a single
// flagged flagship dominates totalStars.
function repo(owner: string, name: string, stars = 0) {
  return {
    name,
    full_name: `${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
    description: "A service",
    fork: false,
    stargazers_count: stars,
    forks_count: 0,
    language: "Python",
    updated_at: "2026-06-01T00:00:00.000Z",
    pushed_at: "2026-06-01T00:00:00.000Z",
    topics: [] as string[],
    size: 100,
    open_issues_count: 0,
  };
}

// Build one page of `count` repos; if `flagshipStars` is given, the LAST repo on the page
// carries those stars (used to place the flagship on the oldest page).
function page(owner: string, from: number, count: number, flagshipStars = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    const isLast = i === count - 1;
    return repo(owner, `svc-${n}`, isLast ? flagshipStars : 0);
  });
}

// growA: 250 public repos — pagination must fetch all 3 pages (last is short). The
// flagship (1000 stars) sits on page 3, the OLDEST page, exactly the work single-page
// truncation dropped.
// growB: 350 public repos — past the 300 cap, so the run is truncated and must say so.
function githubResponse(url: URL): Response {
  const pathname = url.pathname;
  const p = Number(url.searchParams.get("page") ?? "1");
  if (pathname.endsWith("/languages")) return Response.json({});

  switch (pathname) {
    case "/users/growA":
      return Response.json({
        login: "growA", html_url: "https://github.com/growA", public_repos: 250, followers: 0, type: "User",
      });
    case "/users/growA/repos":
      if (p === 1) return Response.json(page("growA", 1, 100));
      if (p === 2) return Response.json(page("growA", 101, 100));
      if (p === 3) return Response.json(page("growA", 201, 50, 1000)); // short page → end; flagship here
      return Response.json([]);

    case "/users/growB":
      return Response.json({
        login: "growB", html_url: "https://github.com/growB", public_repos: 350, followers: 0, type: "User",
      });
    case "/users/growB/repos":
      // Three FULL pages (cap) with more still behind them → truncated.
      if (p <= 3) return Response.json(page("growB", (p - 1) * 100 + 1, 100));
      return Response.json([]);

    default:
      throw new Error(`unexpected GitHub fetch in test: ${pathname}?page=${p}`);
  }
}

before(() => {
  process.env.KP_LOG_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-gh-page-log-"));
  delete process.env.GEMINI_API_KEY; // deep review short-circuits to "disabled" — no bundle fetches
  delete process.env.GOOGLE_API_KEY;
  globalThis.fetch = (async (u: RequestInfo | URL) => githubResponse(new URL(String(u)))) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/github-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("#3 pagination analyzes >100 repos, so a page-3 flagship's stars are counted", async () => {
  const res = await POST(post({ profile: "growA", jobDescriptionText: "" }) as never);
  const body = (await res.json()) as {
    error?: string;
    metrics: { ownedReposAnalyzed: number; publicRepos: number; totalStars: number };
    limitations: string[];
  };

  assert.equal(body.error, undefined);
  // All 250 owned repos analyzed — not the single-page 100.
  assert.equal(body.metrics.ownedReposAnalyzed, 250, "all pages are analyzed, not just the first 100");
  assert.equal(body.metrics.publicRepos, 250);
  // The flagship on the OLDEST page (page 3) contributes its stars — the exact signal
  // single-page sort=updated dropped.
  assert.equal(body.metrics.totalStars, 1000, "the oldest-page flagship is counted");
  // A complete read (short final page) carries no truncation note.
  assert.ok(
    !body.limitations.some((l) => /were not included in the totals/.test(l)),
    "a complete run must NOT claim truncation",
  );
  // NON-VACUITY: pre-fix, only page 1 was fetched → ownedReposAnalyzed 100 and
  // totalStars 0 (the flagship on page 3 never fetched), so both equalities fail.
});

test("#3 an account past the page cap is annotated as truncated, never presented as complete", async () => {
  const res = await POST(post({ profile: "growB", jobDescriptionText: "" }) as never);
  const body = (await res.json()) as {
    error?: string;
    metrics: { ownedReposAnalyzed: number; publicRepos: number };
    limitations: string[];
  };

  assert.equal(body.error, undefined);
  assert.equal(body.metrics.ownedReposAnalyzed, 300, "the cap bounds analysis at 300 repos");
  assert.equal(body.metrics.publicRepos, 350, "the true count is still reported");
  // The undercount is surfaced honestly instead of implying a full portfolio.
  assert.ok(
    body.limitations.some((l) => /analyzed of 350 public/.test(l) && /were not included in the totals/.test(l)),
    `truncation must be annotated; saw ${JSON.stringify(body.limitations)}`,
  );
  // NON-VACUITY: pre-fix, a single page returned 100 repos with no truncation note, so
  // both the ownedReposAnalyzed === 300 equality and the limitation assertion fail.
});
