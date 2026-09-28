// readSeekerGithub over a scripted GitHub (no network): identity is a gate, only owned
// non-forks are read, an unreadable account is a state and never an empty snapshot, a
// throttle in the middle of the language reads keeps what was read and says so, and the
// list is capped and ordered by push. portfolioCandidates is pure and ranks substance over
// popularity. The default transport is exercised once, under KP_OFFLINE, to prove it
// refuses before any socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GithubReadOutcome, githubRead } from "../repo-snapshot.ts";
import {
  PORTFOLIO_WINDOW_MONTHS,
  SEEKER_GITHUB_FIELDS,
  SEEKER_LANGUAGE_READ_CAP,
  SEEKER_REPO_CAP,
  portfolioCandidates,
  readSeekerGithub,
  type SeekerGithubSnapshot,
  type SeekerRepo,
} from "./github.ts";

const NOW = new Date("2026-09-28T08:00:00.000Z");
const GH = "https://api.github.com";
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

type Outcome = GithubReadOutcome<unknown>;
type Route = (url: string) => Outcome | undefined;

/** A scripted githubRead: the first route that answers wins; anything unrouted is a test bug. */
function scripted(route: Route, calls: string[] = []): typeof githubRead {
  const read = async <T,>(url: string): Promise<GithubReadOutcome<T>> => {
    calls.push(url);
    const out = route(url);
    if (!out) throw new Error(`unscripted GitHub read: ${url}`);
    return out as GithubReadOutcome<T>;
  };
  return read;
}

const ok = (data: unknown): Outcome => ({ ok: true, data });

function userPayload(over: Record<string, unknown> = {}) {
  return {
    login: "Seeker",
    name: "Seeker Person",
    html_url: "https://github.com/Seeker",
    public_repos: 3,
    followers: 4,
    type: "User",
    ...over,
  };
}

function repoRow(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    full_name: `Seeker/${name}`,
    html_url: `https://github.com/Seeker/${name}`,
    description: `${name} does one thing well`,
    fork: false,
    private: false,
    archived: false,
    owner: { login: "Seeker" },
    stargazers_count: 1,
    forks_count: 0,
    language: "TypeScript",
    updated_at: daysAgo(1),
    pushed_at: daysAgo(10),
    created_at: "2024-01-15T10:00:00Z",
    topics: ["nextjs"],
    size: 120,
    open_issues_count: 0,
    ...over,
  };
}

const isUser = (url: string) => url === `${GH}/users/Seeker` || url === `${GH}/users/seeker`;
const isList = (url: string) => url.startsWith(`${GH}/users/Seeker/repos?`);
const pageOf = (url: string) => Number(new URL(url).searchParams.get("page"));
const languagesOf = (url: string) => /\/repos\/Seeker\/([^/]+)\/languages$/.exec(url)?.[1] ?? null;

/** One account: the user, a single short page of rows, and a language answer per repo. */
function account(rows: unknown[], languages: (name: string) => Outcome = () => ok({ TypeScript: 900, CSS: 100 }), user = userPayload()) {
  return (url: string): Outcome | undefined => {
    if (isUser(url)) return ok(user);
    if (isList(url)) return ok(pageOf(url) === 1 ? rows : []);
    const repo = languagesOf(url);
    return repo ? languages(decodeURIComponent(repo)) : undefined;
  };
}

async function snapshotOf(route: Route, calls: string[] = []): Promise<SeekerGithubSnapshot> {
  const out = await readSeekerGithub("seeker", { read: scripted(route, calls), now: () => NOW });
  assert.equal(out.ok, true, `expected an ok read, got ${JSON.stringify(out)}`);
  return (out as { ok: true; snapshot: SeekerGithubSnapshot }).snapshot;
}

// --- identity ----------------------------------------------------------------------------

test("a handle outside the GitHub grammar is invalid_handle and nothing is read", async () => {
  for (const handle of ["", "   ", "two words", "-leading", "trailing-", "a".repeat(40), "https://gitlab.com/seeker", "seeker/repo"]) {
    const calls: string[] = [];
    const out = await readSeekerGithub(handle, { read: scripted(() => ok(userPayload()), calls), now: () => NOW });
    assert.deepEqual(out, { ok: false, state: "invalid_handle" }, handle);
    assert.equal(calls.length, 0, `no request for ${JSON.stringify(handle)}`);
  }
});

test("a profile URL or an @handle is read as the bare handle, and GitHub's own login leads every later URL", async () => {
  for (const handle of ["https://github.com/seeker/", "github.com/seeker?tab=repositories", "@seeker", " seeker "]) {
    const calls: string[] = [];
    const out = await readSeekerGithub(handle, { read: scripted(account([repoRow("kp")]), calls), now: () => NOW });
    assert.equal(out.ok && out.snapshot.login, "Seeker", handle);
    assert.equal(calls.length, 3, handle);
    assert.equal(calls[0], `${GH}/users/seeker`);
    assert.ok(isList(calls[1]), "the list is read under the login GitHub answered with (Seeker)");
    assert.equal(calls[2], `${GH}/repos/Seeker/kp/languages`);
  }
});

test("an organization or a bot is not_a_person, and its repositories are never listed", async () => {
  for (const type of ["Organization", "Bot"]) {
    const calls: string[] = [];
    const out = await readSeekerGithub("seeker", {
      read: scripted(account([repoRow("kp")], undefined, userPayload({ type })), calls),
      now: () => NOW,
    });
    assert.deepEqual(out, { ok: false, state: "not_a_person" }, type);
    assert.deepEqual(calls, [`${GH}/users/seeker`], "identity is checked before anything is attributed");
  }
});

test("a 404 on /users is not_found", async () => {
  const out = await readSeekerGithub("seeker", { read: scripted(() => ({ ok: false, kind: "not_found", status: 404 })), now: () => NOW });
  assert.deepEqual(out, { ok: false, state: "not_found" });
});

test("a user payload that is not an account (no login, no type, no repo count) is failed, not a person", async () => {
  for (const user of [null, "nope", { login: "Seeker", public_repos: 3 }, { type: "User", public_repos: 3 }, userPayload({ public_repos: "3" }), userPayload({ login: "not a login" })]) {
    const out = await readSeekerGithub("seeker", { read: scripted(() => ok(user)), now: () => NOW });
    assert.deepEqual(out, { ok: false, state: "failed" }, JSON.stringify(user));
  }
});

// --- unavailable is not absent -----------------------------------------------------------

test("a throttle on /users is its own state and carries GitHub's retry hint, never an empty snapshot", async () => {
  const out = await readSeekerGithub("seeker", {
    read: scripted(() => ({ ok: false, kind: "throttled", status: 403, retryAfterSec: 120 })),
    now: () => NOW,
  });
  assert.deepEqual(out, { ok: false, state: "throttled", retryAfterSec: 120 });
});

test("every other transport outcome maps to a state: 5xx and a dead network are unreachable, the rest failed", async () => {
  const cases: Array<[Outcome, unknown]> = [
    [{ ok: false, kind: "unreachable", cause: new Error("ECONNRESET") }, { ok: false, state: "unreachable" }],
    [{ ok: false, kind: "http_error", status: 503, retryAfterSec: 30 }, { ok: false, state: "unreachable", retryAfterSec: 30 }],
    [{ ok: false, kind: "http_error", status: 401 }, { ok: false, state: "failed" }],
    [{ ok: false, kind: "bad_shape", status: 200 }, { ok: false, state: "failed" }],
    [{ ok: false, kind: "too_large", status: 200 }, { ok: false, state: "failed" }],
    [{ ok: false, kind: "offline" }, { ok: false, state: "offline" }],
  ];
  for (const [outcome, expected] of cases) {
    const out = await readSeekerGithub("seeker", { read: scripted(() => outcome), now: () => NOW });
    assert.deepEqual(out, expected, JSON.stringify(outcome));
  }
});

test("a repository page that cannot be read fails the whole read; a 200 that is not a list is failed", async () => {
  const throttledList = await readSeekerGithub("seeker", {
    read: scripted((url) => (isUser(url) ? ok(userPayload()) : { ok: false, kind: "throttled", status: 429, retryAfterSec: 60 })),
    now: () => NOW,
  });
  assert.deepEqual(throttledList, { ok: false, state: "throttled", retryAfterSec: 60 });
  const notice = await readSeekerGithub("seeker", {
    read: scripted((url) => (isUser(url) ? ok(userPayload()) : ok({ message: "You have exceeded a secondary rate limit" }))),
    now: () => NOW,
  });
  assert.deepEqual(notice, { ok: false, state: "failed" });
});

test("offline: the default transport refuses under KP_OFFLINE before any socket is opened", async () => {
  const previousEnv = process.env.KP_OFFLINE;
  const previousFetch = globalThis.fetch;
  let sockets = 0;
  globalThis.fetch = (async () => {
    sockets++;
    throw new Error("no fetch may happen offline");
  }) as typeof fetch;
  process.env.KP_OFFLINE = "1";
  try {
    const out = await readSeekerGithub("seeker", { now: () => NOW });
    assert.deepEqual(out, { ok: false, state: "offline" });
    assert.equal(sockets, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = previousEnv;
  }
});

test("an account with no public repositories is an ok read with nothing in it, because that was read", async () => {
  const snapshot = await snapshotOf(account([], undefined, userPayload({ public_repos: 0 })));
  assert.deepEqual(snapshot.repos, []);
  assert.deepEqual(snapshot.languageReads, { planned: 0, read: 0 });
  assert.equal(snapshot.truncated, false);
  assert.deepEqual(snapshot.budget, { repos: 0, fields: SEEKER_GITHUB_FIELDS.filter((f) => f !== "languages") });
});

// --- attribution -------------------------------------------------------------------------

test("only rows the account owns and that say they are not forks are kept; the list asks for owner rows", async () => {
  const calls: string[] = [];
  const rows = [
    repoRow("own-work"),
    repoRow("a-fork", { fork: true }),
    repoRow("unsaid", { fork: undefined }),
    repoRow("borrowed", { full_name: "someone-else/borrowed", owner: { login: "someone-else" } }),
    repoRow("no-owner-object", { owner: null, full_name: "someone-else/no-owner-object" }),
    repoRow("hidden", { private: true }),
    "not a row",
    { name: "half" },
    repoRow("Own-Other-Case", { owner: { login: "seeker" } }),
  ];
  const snapshot = await snapshotOf(account(rows), calls);
  assert.deepEqual(
    snapshot.repos.map((r) => r.name).sort(),
    ["Own-Other-Case", "own-work"],
    "forks, rows another account owns, private rows and malformed rows are dropped",
  );
  const listUrl = new URL(calls.find(isList) ?? "");
  assert.equal(listUrl.searchParams.get("type"), "owner");
  assert.equal(listUrl.searchParams.get("sort"), "pushed");
  assert.equal(listUrl.searchParams.get("per_page"), "100");
});

test("the snapshot carries the account, the read time and each repository's labels, archived and createdAt included", async () => {
  const rows = [
    repoRow("kp", { stargazers_count: 7, topics: ["nextjs", "  ", "nextjs", "llm", 3], size: 5400, description: "  A recruiting\nstudio  " }),
    repoRow("old-tool", { archived: true, pushed_at: daysAgo(400), created_at: "2019-03-01T00:00:00Z", language: null, description: null }),
  ];
  const snapshot = await snapshotOf(account(rows, () => ok({ TypeScript: 9000, Python: 1000, Weird: -5, Fraction: 1.5 })));
  assert.equal(snapshot.login, "Seeker");
  assert.equal(snapshot.name, "Seeker Person");
  assert.equal(snapshot.htmlUrl, "https://github.com/Seeker");
  assert.equal(snapshot.publicRepos, 3);
  assert.equal(snapshot.readAt, NOW.toISOString());
  assert.deepEqual(snapshot.repos[0], {
    name: "kp",
    fullName: "Seeker/kp",
    htmlUrl: "https://github.com/Seeker/kp",
    description: "A recruiting studio",
    language: "TypeScript",
    languages: { TypeScript: 9000, Python: 1000 },
    topics: ["nextjs", "llm"],
    stars: 7,
    pushedAt: daysAgo(10),
    createdAt: "2024-01-15T10:00:00Z",
    archived: false,
    sizeKb: 5400,
  });
  assert.deepEqual(snapshot.repos[1], {
    name: "old-tool",
    fullName: "Seeker/old-tool",
    htmlUrl: "https://github.com/Seeker/old-tool",
    description: null,
    language: null,
    languages: null,
    topics: ["nextjs"],
    stars: 1,
    pushedAt: daysAgo(400),
    createdAt: "2019-03-01T00:00:00Z",
    archived: true,
    sizeKb: 120,
  });
  assert.deepEqual(snapshot.budget, { repos: 2, fields: [...SEEKER_GITHUB_FIELDS] });
});

test("a link that is not a github.com page is rebuilt from the full name, never passed onto a CV", async () => {
  const snapshot = await snapshotOf(account([repoRow("kp", { html_url: "javascript:alert(1)" })], undefined, userPayload({ html_url: "http://evil.example/Seeker" })));
  assert.equal(snapshot.repos[0].htmlUrl, "https://github.com/Seeker/kp");
  assert.equal(snapshot.htmlUrl, "https://github.com/Seeker");
});

// --- cap and ordering --------------------------------------------------------------------

test("most recently pushed first, never-pushed last, at most SEEKER_REPO_CAP; paging stops once the cap is held", async () => {
  // Page 1: 100 rows, half of them forks, in an order that is NOT push order. Page 2: 100
  // owned rows. After page 2 more than 60 are held, so page 3 is never asked for.
  const page1 = Array.from({ length: 100 }, (_, i) =>
    repoRow(`p1-${String(i).padStart(3, "0")}`, { fork: i % 2 === 1, pushed_at: daysAgo((i * 37) % 97) }),
  );
  page1[4] = repoRow("never-pushed", { pushed_at: null });
  const page2 = Array.from({ length: 100 }, (_, i) => repoRow(`p2-${String(i).padStart(3, "0")}`, { pushed_at: daysAgo(100 + i) }));
  const calls: string[] = [];
  const snapshot = await snapshotOf((url) => {
    if (isUser(url)) return ok(userPayload({ public_repos: 250 }));
    if (isList(url)) return ok(pageOf(url) === 1 ? page1 : pageOf(url) === 2 ? page2 : []);
    return languagesOf(url) ? ok({ TypeScript: 10 }) : undefined;
  }, calls);
  assert.deepEqual(calls.filter(isList).map(pageOf), [1, 2], "stopped at the cap, never read page 3");
  assert.equal(snapshot.repos.length, SEEKER_REPO_CAP);
  assert.equal(snapshot.truncated, false, "holding the cap is not a cut list");
  const pushed = snapshot.repos.map((r) => Date.parse(r.pushedAt ?? ""));
  for (let i = 1; i < pushed.length; i++) assert.ok(pushed[i - 1] >= pushed[i], `ordered by push at ${i}`);
  assert.ok(snapshot.repos.every((r) => !r.name.startsWith("p1-") || Number(r.name.slice(3)) % 2 === 0), "no fork survived");
  assert.ok(!snapshot.repos.some((r) => r.name === "never-pushed"), "the never-pushed row sorts behind 60 pushed ones");
});

test("a repository that was never pushed sorts last rather than first", async () => {
  const snapshot = await snapshotOf(account([repoRow("never", { pushed_at: null }), repoRow("older", { pushed_at: daysAgo(300) }), repoRow("newer", { pushed_at: daysAgo(3) })]));
  assert.deepEqual(snapshot.repos.map((r) => r.name), ["newer", "older", "never"]);
});

test("the owner list is truncated only when the page cap cut it with more to read", async () => {
  const mostlyForks = (page: number) =>
    Array.from({ length: 100 }, (_, i) => repoRow(`r${page}-${i}`, { fork: i >= 10, pushed_at: daysAgo(page * 100 + i) }));
  const calls: string[] = [];
  const cut = await snapshotOf((url) => {
    if (isUser(url)) return ok(userPayload({ public_repos: 450 }));
    if (isList(url)) return ok(mostlyForks(pageOf(url)));
    return languagesOf(url) ? ok({}) : undefined;
  }, calls);
  assert.deepEqual(calls.filter(isList).map(pageOf), [1, 2, 3], "three pages, never a fourth");
  assert.equal(cut.repos.length, 30);
  assert.equal(cut.truncated, true);

  const exact = await snapshotOf((url) => {
    if (isUser(url)) return ok(userPayload({ public_repos: 300 }));
    if (isList(url)) return ok(mostlyForks(pageOf(url)));
    return languagesOf(url) ? ok({}) : undefined;
  });
  assert.equal(exact.truncated, false, "300 read of 300: nothing was cut");
});

// --- the language reads ------------------------------------------------------------------

test("languages are read for at most the 12 most recently pushed NON-archived repositories", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => repoRow(`r${String(i).padStart(2, "0")}`, { pushed_at: daysAgo(i + 1), archived: i === 0 || i === 5 }));
  const calls: string[] = [];
  const snapshot = await snapshotOf(account(rows), calls);
  const read = calls.map(languagesOf).filter((name): name is string => name !== null);
  assert.equal(read.length, SEEKER_LANGUAGE_READ_CAP);
  assert.deepEqual(read, ["r01", "r02", "r03", "r04", "r06", "r07", "r08", "r09", "r10", "r11", "r12", "r13"]);
  assert.deepEqual(snapshot.languageReads, { planned: 12, read: 12 });
  assert.equal(snapshot.repos.find((r) => r.name === "r00")?.languages, null, "an archived repo's languages are not read");
  assert.equal(snapshot.repos.find((r) => r.name === "r14")?.languages, null, "past the cap: not read, not empty");
});

test("a throttle in the middle of the language reads stops them, keeps what was read, says partial, and the read stays ok", async () => {
  const rows = ["a", "b", "c", "d", "e"].map((name, i) => repoRow(name, { pushed_at: daysAgo(i + 1) }));
  const calls: string[] = [];
  const snapshot = await snapshotOf(
    account(rows, (name) => (name === "c" ? { ok: false, kind: "throttled", status: 403, retryAfterSec: 900 } : ok({ Python: 100 }))),
    calls,
  );
  assert.deepEqual(calls.map(languagesOf).filter(Boolean), ["a", "b", "c"], "no read after the throttle");
  assert.deepEqual(snapshot.languageReads, { planned: 5, read: 2 });
  assert.deepEqual(snapshot.repos.map((r) => r.languages), [{ Python: 100 }, { Python: 100 }, null, null, null]);
  assert.ok(snapshot.budget.fields.includes("languages"));
  assert.equal(snapshot.repos.length, 5, "the repositories themselves are all still there");
});

test("a per-repository language failure leaves only that repository unread; an empty map is a real read", async () => {
  const rows = ["a", "b", "c"].map((name, i) => repoRow(name, { pushed_at: daysAgo(i + 1) }));
  const snapshot = await snapshotOf(
    account(rows, (name) =>
      name === "a" ? { ok: false, kind: "not_found", status: 404 } : name === "b" ? ok(["not", "a", "map"]) : ok({}),
    ),
  );
  assert.deepEqual(snapshot.repos.map((r) => r.languages), [null, null, {}]);
  assert.deepEqual(snapshot.languageReads, { planned: 3, read: 1 });
});

test("unreachable during the language reads stops them too; a snapshot with no language read does not claim the field", async () => {
  const rows = ["a", "b"].map((name, i) => repoRow(name, { pushed_at: daysAgo(i + 1) }));
  const calls: string[] = [];
  const snapshot = await snapshotOf(account(rows, () => ({ ok: false, kind: "unreachable", cause: new Error("timeout") })), calls);
  assert.equal(calls.filter((url) => languagesOf(url)).length, 1);
  assert.deepEqual(snapshot.languageReads, { planned: 2, read: 0 });
  assert.ok(!snapshot.budget.fields.includes("languages"));
});

test("repository names are path-encoded in the language URL", async () => {
  const calls: string[] = [];
  await snapshotOf(account([repoRow("dots.and-dashes_ok")]), calls);
  assert.equal(calls.at(-1), `${GH}/repos/Seeker/dots.and-dashes_ok/languages`);
});

// --- portfolioCandidates -----------------------------------------------------------------

function seekerRepo(name: string, over: Partial<SeekerRepo> = {}): SeekerRepo {
  return {
    name,
    fullName: `Seeker/${name}`,
    htmlUrl: `https://github.com/Seeker/${name}`,
    description: `${name} described`,
    language: "TypeScript",
    languages: null,
    topics: [],
    stars: 0,
    pushedAt: daysAgo(10),
    createdAt: daysAgo(400),
    archived: false,
    sizeKb: 100,
    ...over,
  };
}

function snapshotWith(repos: SeekerRepo[], readAt = NOW.toISOString()): SeekerGithubSnapshot {
  return {
    login: "Seeker",
    name: null,
    htmlUrl: "https://github.com/Seeker",
    publicRepos: repos.length,
    readAt,
    repos,
    truncated: false,
    languageReads: { planned: 0, read: 0 },
    budget: { repos: repos.length, fields: [] },
  };
}

test("portfolio candidates are live, described, non-empty and recent: archived, bare, empty and stale repositories are not offered", async () => {
  const snapshot = snapshotWith([
    seekerRepo("keep"),
    seekerRepo("archived", { archived: true }),
    seekerRepo("no-description", { description: null }),
    seekerRepo("blank-description", { description: "   " }),
    seekerRepo("empty", { sizeKb: 0 }),
    seekerRepo("stale", { pushedAt: daysAgo(PORTFOLIO_WINDOW_MONTHS * 30 + 5) }),
    seekerRepo("never-pushed", { pushedAt: null }),
    seekerRepo("inside-window", { pushedAt: daysAgo(PORTFOLIO_WINDOW_MONTHS * 30 - 5) }),
  ]);
  assert.deepEqual(portfolioCandidates(snapshot).map((r) => r.name), ["keep", "inside-window"]);
});

test("portfolio ranking: recency window first, then size, and stars only break a tie", () => {
  const snapshot = snapshotWith([
    seekerRepo("tiny-today", { pushedAt: daysAgo(0), sizeKb: 20, stars: 900 }),
    seekerRepo("big-last-week", { pushedAt: daysAgo(7), sizeKb: 50_000 }),
    seekerRepo("mid-two-months", { pushedAt: daysAgo(60), sizeKb: 3_000 }),
    seekerRepo("huge-half-year", { pushedAt: daysAgo(180), sizeKb: 900_000, stars: 5_000 }),
    seekerRepo("huge-eighteen-months", { pushedAt: daysAgo(540), sizeKb: 2_000_000 }),
    seekerRepo("twin-few-stars", { pushedAt: daysAgo(200), sizeKb: 800, stars: 1 }),
    seekerRepo("twin-more-stars", { pushedAt: daysAgo(210), sizeKb: 800, stars: 40 }),
  ]);
  assert.deepEqual(portfolioCandidates(snapshot, 10).map((r) => r.name), [
    "big-last-week",
    "mid-two-months",
    "tiny-today",
    "huge-half-year",
    "twin-more-stars",
    "twin-few-stars",
    "huge-eighteen-months",
  ]);
});

test("portfolio candidates default to six, honour n, and answer nothing for n <= 0 or a readAt that is not a date", () => {
  const repos = Array.from({ length: 9 }, (_, i) => seekerRepo(`r${i}`, { sizeKb: 100 + i }));
  assert.equal(portfolioCandidates(snapshotWith(repos)).length, 6);
  assert.deepEqual(portfolioCandidates(snapshotWith(repos), 2).map((r) => r.name), ["r8", "r7"]);
  assert.deepEqual(portfolioCandidates(snapshotWith(repos), 0), []);
  assert.deepEqual(portfolioCandidates(snapshotWith(repos), -3), []);
  assert.deepEqual(portfolioCandidates(snapshotWith(repos, "not a date")), []);
});

test("portfolio candidates are pure: recency is measured from readAt, and the snapshot is not touched", () => {
  const repos = [seekerRepo("a", { pushedAt: "2024-06-01T00:00:00Z" }), seekerRepo("b", { pushedAt: "2021-01-01T00:00:00Z" })];
  const snapshot = snapshotWith(repos, "2024-12-01T00:00:00Z");
  const before = structuredClone(snapshot);
  assert.deepEqual(portfolioCandidates(snapshot).map((r) => r.name), ["a"], "b is stale relative to the READ, whatever today is");
  assert.deepEqual(portfolioCandidates(snapshot).map((r) => r.name), ["a"]);
  assert.deepEqual(snapshot, before);
});
