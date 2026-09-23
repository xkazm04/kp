// Source-level guard: the matrix's build-from-analysis action must open the editor
// through a callback, not by pushing `?tab=archetypes&fromAnalysis=` onto the tab
// that is already mounted. That push never remounts ProfileTab, so the mount-only
// deep-link effect never runs and both the chip action and the detail-modal footer
// were inert. The roster's Rebuild was switched to `openRebuild` for the same reason.
//
// Every assertion is proved non-vacuous against a MUTATED copy of the same source.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const matrix = read("./CandidateMatrix.tsx");
const tab = read("./ProfileTab.tsx");

/** Assert `pattern` matches `src`, and that it does NOT match `src` with `mutate`
 *  applied — so the guard is proved to be watching something real. */
function pins(src: string, pattern: RegExp, mutate: (s: string) => string, why: string): void {
  assert.match(src, pattern, why);
  assert.doesNotMatch(mutate(src), pattern, `non-vacuity: the guard for "${why}" must fail on a broken source`);
}

test("the matrix no longer emits fromAnalysis onto the current tab", () => {
  assert.doesNotMatch(
    matrix,
    /fromAnalysis:\s*slug/,
    "the matrix must not write fromAnalysis onto a same-tab URL"
  );
  assert.doesNotMatch(matrix, /router\.push/, "the matrix must not navigate to open the editor");
  assert.doesNotMatch(matrix, /useRouter|buildUrl/, "router/buildUrl were only used for that dead push");
});

test("both matrix call sites invoke onBuildFromAnalysis with the slug", () => {
  pins(
    matrix,
    /onBuildFromAnalysis:\s*\(slug: string\) => void/,
    (s) => s.replace("onBuildFromAnalysis: (slug: string) => void", "onEditProfile: (id: string) => void"),
    "CandidateMatrix takes onBuildFromAnalysis as a required callback"
  );
  // The chip action reads matrixChipAction (app/_lib/candidate-population.ts): the
  // population is keyed on CV identity, so a row that carries a profile id is EDITED
  // and only an analysis-only row builds. It still opens the editor via the callback.
  pins(
    matrix,
    /else if \(action\?\.kind === "build"\) onBuildFromAnalysis\(action\.slug\)/,
    (s) => s.replace("onBuildFromAnalysis(action.slug)", "onEditProfile(action.slug)"),
    "the chip action (onSave) opens the editor via the callback"
  );
  pins(
    matrix,
    /const action = matrixChipAction\(cand\);/,
    (s) => s.replace("const action = matrixChipAction(cand);", "const action = { kind: \"build\", slug: cand.slug };"),
    "the chip action is decided by matrixChipAction, which never builds when a profile id is present"
  );
  // The defect this replaced: branching on `source` sent a merged row's slug to the
  // build door, filing a second profile for a CV that already had one.
  assert.doesNotMatch(matrix, /onBuildFromAnalysis\(cand\.slug\)/, "the chip must not build straight off the row's slug");
  pins(
    matrix,
    /onBuildFromAnalysis=\{onBuildFromAnalysis\}/,
    (s) => s.replace("onBuildFromAnalysis={onBuildFromAnalysis}", "onBuildFromAnalysis={undefined}"),
    "the detail-modal footer is wired to the same callback"
  );
});

test("ProfileTab feeds openFromAnalysis into the matrix, not a URL push", () => {
  pins(
    tab,
    /onBuildFromAnalysis=\{\(slug\) => void openFromAnalysis\(slug, null\)\}/,
    (s) => s.replace("onBuildFromAnalysis={(slug) => void openFromAnalysis(slug, null)}", ""),
    "the already-mounted archetypes tab opens the editor with sourceAnalysisSlug set"
  );
});

// ── One population read for the whole tab (challenge-r05 profile-roster-matrix/A) ──
//
// The roster, the matrix and the retire dialog each fetched their own copy of the
// candidate population (GET /api/profile, GET /api/profile/candidates, GET /api/profile
// again), and a `dataRev` -> `reloadKey` counter existed only to re-sync the forks after
// a delete. ProfileTab now owns ONE read (useCandidatePopulation) and every projection
// takes rows as props. A negative guard is proved by INJECTING the forbidden read into a
// copy of the source and watching the pattern catch it.

const roster = read("./ProfileRoster.tsx");
const manager = read("./ArchetypeManager.tsx");
const hook = read("./useCandidatePopulation.ts");

/** Assert `pattern` does NOT match `src`, and DOES match `src` with `inject` applied —
 *  so an absence guard is proved to be watching for something real. */
function forbids(src: string, pattern: RegExp, inject: (s: string) => string, why: string): void {
  assert.doesNotMatch(src, pattern, why);
  assert.match(inject(src), pattern, `non-vacuity: the guard for "${why}" must fire on a regressed source`);
}

const PROFILE_LIST_READ = /fetch\(\s*["'`]\/api\/profile["'`]/;
const POPULATION_READ = /fetch\(\s*["'`]\/api\/profile\/candidates/;

test("no projection reads the population on its own", () => {
  forbids(roster, PROFILE_LIST_READ, (s) => `${s}\nfetch("/api/profile", { signal });`, "the roster does not fetch the profile list");
  forbids(roster, POPULATION_READ, (s) => `${s}\nfetch("/api/profile/candidates");`, "the roster does not fetch the population");
  forbids(matrix, PROFILE_LIST_READ, (s) => `${s}\nfetch("/api/profile");`, "the matrix does not fetch the profile list");
  forbids(matrix, POPULATION_READ, (s) => `${s}\nfetch("/api/profile/candidates");`, "the matrix does not fetch the population");
  forbids(manager, /fetch\(\s*["'`]\/api\/profile["'`]\s*\)/, (s) => `${s}\nvoid fetch("/api/profile");`, "the retire dialog does not re-read the roster to count");
  // The one delete the roster still performs is a write, not a read — it stays.
  assert.match(roster, /method: "DELETE"/, "the roster still deletes through the API");
});

test("the tab has no sync counter: dataRev and reloadKey are gone", () => {
  forbids(tab, /\bdataRev\b/, (s) => `${s}\nconst [dataRev, setDataRev] = useState(0);`, "ProfileTab has no dataRev");
  forbids(tab, /\breloadKey\b/, (s) => `${s}\n<CandidateMatrix reloadKey={0} />`, "ProfileTab passes no reloadKey");
  forbids(matrix, /\breloadKey\b/, (s) => `${s}\n  reloadKey = 0,`,"CandidateMatrix takes no reloadKey");
});

test("ProfileTab mounts the ONE read and hands the same rows to every consumer", () => {
  pins(
    tab,
    /useCandidatePopulation\(/,
    (s) => s.replace(/useCandidatePopulation\(/g, "useSomethingElse("),
    "ProfileTab owns the population read"
  );
  pins(
    tab,
    /<ArchetypeManager[^>]*population=\{population\.rows\}/,
    (s) => s.replace("population={population.rows}", ""),
    "the retire dialog counts from the tab's population"
  );
  pins(
    manager,
    /routedCount\(population, archiveTarget\.id\)/,
    (s) => s.replace("routedCount(population, archiveTarget.id)", "null"),
    "the retire count is derived from the population, both stores"
  );
  // Exactly one fetch of the population in the hook, and it is cancellable.
  assert.equal((hook.match(/fetch\(/g) ?? []).length, 1, "the hook issues exactly one read");
  pins(
    hook,
    /fetch\("\/api\/profile\/candidates", \{ signal: controller\.signal \}\)/,
    (s) => s.replace("{ signal: controller.signal }", "{}"),
    "the one read is cancelled on unmount/refetch, not merely ignored"
  );
});

// Tenancy: the population read is scoped to the CALLER's workspace. Every store read in
// the route takes the `ws` the route resolved — a read that fell back to the default
// workspace would serve one team's candidates (and their staleness) to another.
const candidatesRoute = read("../../../api/profile/candidates/route.ts");
test("the population route passes the resolved workspace to every store read", () => {
  pins(
    candidatesRoute,
    /const ws = await currentWorkspace\(\);/,
    (s) => s.replace("const ws = await currentWorkspace();", "const ws = DEFAULT_WORKSPACE_ID;"),
    "the route resolves the caller's workspace"
  );
  for (const call of ["listAnalysisRecords(200, ws)", "cachedProfileRecords(ws)", "profileStaleness(ws)"]) {
    pins(
      candidatesRoute,
      new RegExp(call.replace(/[()]/g, "\\$&")),
      (s) => s.replace(call, call.replace(/,? ?ws\)/, ")")),
      `${call} is workspace-scoped`
    );
  }
});
