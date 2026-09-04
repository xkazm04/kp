// The ranking and complexity heuristics decide WHICH of a candidate's repos a
// recruiter sees and which three get the paid deep review — a hiring-facing
// ordering with no test of its own until now. Every constant here was tunable
// without a single assertion noticing, so this file pins the PROPERTIES (ordering,
// the unit of repo.size, the cutoffs, the "never empty" contract) rather than the
// numbers, so a deliberate re-tune stays possible and an accidental one does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContributionSignals,
  buildSummary,
  complexityAssessment,
  complexitySignals,
  mergeLanguageMaps,
  repoRank,
  summarizeLanguages,
} from "./heuristics.ts";
import type { GithubRepo, GithubUser } from "./client.ts";

const RECENT = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
const ANCIENT = "2015-01-01T00:00:00.000Z";

function repo(over: Partial<GithubRepo> = {}): GithubRepo {
  return {
    name: "repo",
    full_name: "octocat/repo",
    html_url: "https://github.com/octocat/repo",
    description: null,
    fork: false,
    stargazers_count: 0,
    forks_count: 0,
    language: "TypeScript",
    updated_at: ANCIENT,
    pushed_at: ANCIENT,
    topics: [],
    size: 0,
    open_issues_count: 0,
    ...over,
  };
}

// --- repoRank ----------------------------------------------------------------

test("stars outrank forks, and both outrank raw size", () => {
  const starred = repoRank(repo({ stargazers_count: 1 }));
  const forked = repoRank(repo({ forks_count: 1 }));
  assert.ok(starred > forked, "a star is the strongest public-interest signal");
  // repo.size is KILOBYTES: 500 KB buys ONE point, so a large repo cannot out-rank
  // real traction. This is the unit the comment in heuristics.ts warns about.
  assert.equal(repoRank(repo({ size: 500 })), 1);
  assert.ok(forked > repoRank(repo({ size: 1000 })), "2 MB of code loses to a single fork");
});

test("a repo pushed within the year takes the freshness bonus; an ancient one does not", () => {
  const fresh = repoRank(repo({ pushed_at: RECENT }));
  const stale = repoRank(repo({ pushed_at: ANCIENT }));
  assert.equal(fresh - stale, 20, "the recency bonus is flat and only fires inside the window");
  // pushed_at is the code-activity clock; updated_at is only the fallback for a repo
  // that never reported a push (a rename/star bump must not read as maintenance).
  assert.equal(repoRank(repo({ pushed_at: null, updated_at: RECENT })), fresh);
  assert.equal(repoRank(repo({ pushed_at: ANCIENT, updated_at: RECENT })), stale);
});

test("ranking orders the list the panel and the deep-review shortlist are cut from", () => {
  const flagship = repo({ name: "flagship", stargazers_count: 50 });
  const busy = repo({ name: "busy", pushed_at: RECENT, forks_count: 2 });
  const dormant = repo({ name: "dormant", size: 2000 });
  const ordered = [dormant, busy, flagship].sort((a, b) => repoRank(b) - repoRank(a)).map((r) => r.name);
  assert.deepEqual(ordered, ["flagship", "busy", "dormant"]);
});

// --- complexitySignals -------------------------------------------------------

test("each cutoff is a threshold, not a range: just under it emits nothing", () => {
  const kinds = (r: GithubRepo) => complexitySignals(r).map((s) => s.kind);
  assert.deepEqual(kinds(repo({ size: 5000 })), ["signal.metadataOnly"], "size is strictly greater-than");
  assert.deepEqual(kinds(repo({ size: 5001 })), ["signal.largeCodebase"]);
  assert.deepEqual(kinds(repo({ stargazers_count: 9 })), ["signal.metadataOnly"]);
  assert.deepEqual(kinds(repo({ stargazers_count: 10 })), ["signal.stars"], "stars is >=");
  assert.deepEqual(kinds(repo({ forks_count: 2 })), ["signal.metadataOnly"]);
  assert.deepEqual(kinds(repo({ forks_count: 3 })), ["signal.forks"], "forks is >=");
  assert.deepEqual(kinds(repo({ open_issues_count: 1 })), ["signal.issues"]);
});

test("a delivery-practice topic counts, an unrelated topic does not", () => {
  const kinds = (topics: string[]) => complexitySignals(repo({ topics })).map((s) => s.kind);
  assert.deepEqual(kinds(["kubernetes"]), ["signal.deliveryTopic"]);
  assert.deepEqual(kinds(["CI"]), ["signal.deliveryTopic"], "the topic match is case-insensitive");
  assert.deepEqual(kinds(["poetry"]), ["signal.metadataOnly"]);
});

test("a repo with no signal at all is described as metadata-only, never as an empty list", () => {
  // The panel renders these as findings; an empty array would silently show nothing
  // where the honest answer is "we only saw metadata".
  assert.deepEqual(complexitySignals(repo()), [{ kind: "signal.metadataOnly" }]);
});

// --- complexityAssessment ----------------------------------------------------

test("'complex' needs TWO signals, and the count escalates the recruiter-facing wording", () => {
  const oneSignal = repo({ stargazers_count: 10 });
  const twoSignals = repo({ stargazers_count: 10, forks_count: 3 });
  assert.deepEqual(complexityAssessment([]), { kind: "assessment.thin" });
  assert.deepEqual(
    complexityAssessment([oneSignal, oneSignal, oneSignal, oneSignal]),
    { kind: "assessment.thin" },
    "one signal each is not complexity, however many repos",
  );
  assert.deepEqual(complexityAssessment([twoSignals]), { kind: "assessment.some" });
  assert.deepEqual(complexityAssessment(Array(3).fill(twoSignals)), { kind: "assessment.some" });
  assert.deepEqual(complexityAssessment(Array(4).fill(twoSignals)), { kind: "assessment.strong" });
});

// --- language summarization --------------------------------------------------

test("language maps merge by byte totals and summarize to a sorted top-10 with percentages", () => {
  const totals = mergeLanguageMaps([{ TypeScript: 100, Go: 50 }, { TypeScript: 100 }, {}]);
  assert.equal(totals.get("TypeScript"), 200);
  const shares = summarizeLanguages(totals);
  assert.deepEqual(shares.map((s) => s.name), ["TypeScript", "Go"], "sorted by bytes, descending");
  assert.equal(shares[0].percent, 80);
  assert.equal(shares[1].percent, 20);
});

test("summarizing nothing yields nothing, and never divides by zero", () => {
  assert.deepEqual(summarizeLanguages(new Map()), []);
});

test("only the top ten languages are reported", () => {
  const totals = new Map(Array.from({ length: 14 }, (_, i) => [`L${i}`, 14 - i] as [string, number]));
  assert.equal(summarizeLanguages(totals).length, 10);
});

// --- findings carry PARAMS, never pre-formatted sentences --------------------

test("contribution signals travel as params so ICU does the numbers and the plurals", () => {
  const signals = buildContributionSignals({
    ownedRepos: [repo(), repo()],
    totalStars: 7,
    totalForks: 2,
    activeRepos: 1,
    recentlyUpdatedRepos: 2,
    languages: [{ name: "Go", percent: 60 }, { name: "Rust", percent: 40 }],
  });
  const byKind = new Map(signals.map((s) => [s.kind, s.params]));
  assert.deepEqual(byKind.get("contribution.repos"), { count: 2 });
  assert.deepEqual(byKind.get("contribution.traction"), { stars: 7, forks: 2 });
  // Names only: the percentages are rendered as formatted numbers in the meters, not
  // baked into a sentence (cs writes "40 %", fr spaces differently).
  assert.deepEqual(byKind.get("contribution.languages"), { mix: "Go, Rust" });
  assert.ok(!signals.some((s) => s.kind === "contribution.languages" && String(s.params?.mix).includes("%")));
});

test("with no language evidence the languages line is omitted rather than emitted empty", () => {
  const signals = buildContributionSignals({
    ownedRepos: [],
    totalStars: 0,
    totalForks: 0,
    activeRepos: 0,
    recentlyUpdatedRepos: 0,
    languages: [],
  });
  assert.ok(!signals.some((s) => s.kind === "contribution.languages"));
});

test("the summary carries BOTH readings: canonical English and a localizable finding", () => {
  const user = { login: "octocat", html_url: "", public_repos: 2, followers: 1, type: "User" } as GithubUser;
  const withLangs = buildSummary(user, [repo(), repo()], [{ name: "Go", percent: 100 }], 1);
  assert.match(withLangs.text, /octocat has 2 owned public repositories/);
  assert.equal(withLangs.finding.kind, "summary.text");
  assert.deepEqual(withLangs.finding.params, { login: "octocat", repos: 2, active: 1, languages: "Go" });

  // No language evidence is its own finding, not the same sentence with a hole in it.
  const noLangs = buildSummary(user, [repo()], [], 0);
  assert.equal(noLangs.finding.kind, "summary.noLanguages");
  assert.equal(noLangs.finding.params?.languages, undefined);
});
