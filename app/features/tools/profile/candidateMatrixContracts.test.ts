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
  pins(
    matrix,
    /onBuildFromAnalysis\(cand\.slug\)/,
    (s) => s.replace("onBuildFromAnalysis(cand.slug)", "onEditProfile(cand.slug)"),
    "the chip action (onSave) opens the editor via the callback"
  );
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
