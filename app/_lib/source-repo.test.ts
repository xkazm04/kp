// Where the source lives — pinned, because on a modified network-facing deploy
// this is part of an AGPL-3.0 §13 obligation, not a marketing link. A "get the
// source" link that 404s because the operator's configured URL carried a trailing
// slash is a broken licence notice, and nothing tested the join.
//
// SOURCE_REPO_URL is read from the environment at MODULE EVAL, so each case here
// sets NEXT_PUBLIC_SOURCE_REPO_URL and then imports the module under a distinct
// `?v=` query — Node keys its module cache on the full specifier, so that yields a
// genuinely fresh evaluation per configuration inside this one process.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/_lib/source-repo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

type SourceRepo = typeof import("./source-repo.ts");

/** Load source-repo.ts fresh with `NEXT_PUBLIC_SOURCE_REPO_URL` set to `url`
 *  (or unset, to exercise the built-in default). */
async function loadWith(url: string | undefined, tag: string): Promise<SourceRepo> {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SOURCE_REPO_URL;
  else process.env.NEXT_PUBLIC_SOURCE_REPO_URL = url;
  return (await import(`./source-repo.ts?v=${tag}`)) as SourceRepo;
}

test("sourceRepoFileHref: a configured URL WITH a trailing slash does not double it", async () => {
  // NON-VACUITY: a plain `${SOURCE_REPO_URL}/blob/main/${path}` yields
  // "https://git.example.org/fork//blob/main/LICENSE" here — two slashes, which
  // GitHub tolerates but a self-hosted Gitea/Forgejo mirror answers 404 for.
  const m = await loadWith("https://git.example.org/fork/", "slash");
  assert.equal(m.sourceRepoFileHref("LICENSE"), "https://git.example.org/fork/blob/main/LICENSE");
  assert.ok(!m.sourceRepoFileHref("LICENSE").includes("//blob"), "no doubled separator");
  // Several trailing slashes collapse the same way (`/\/+$/`), and the scheme's own
  // "//" must survive — the trim is anchored to the end for exactly that reason.
  const many = await loadWith("https://git.example.org/fork///", "slashes");
  assert.equal(many.sourceRepoFileHref("LICENSE"), "https://git.example.org/fork/blob/main/LICENSE");
  assert.ok(many.sourceRepoFileHref("LICENSE").startsWith("https://"), "the scheme's slashes are untouched");
});

test("sourceRepoFileHref: a leading slash on the PATH is not doubled either", async () => {
  const m = await loadWith("https://git.example.org/fork", "path");
  assert.equal(m.sourceRepoFileHref("/LICENSE"), "https://git.example.org/fork/blob/main/LICENSE");
  assert.equal(m.sourceRepoFileHref("//docs/README.md"), "https://git.example.org/fork/blob/main/docs/README.md");
  // Both ends at once — the configuration a careless operator actually produces.
  const both = await loadWith("https://git.example.org/fork/", "both");
  assert.equal(both.sourceRepoFileHref("/LICENSE"), "https://git.example.org/fork/blob/main/LICENSE");
});

test("sourceRepoFileHref: an inner path keeps its own separators", async () => {
  // Only the JOIN is normalized; a nested path is not otherwise rewritten.
  const m = await loadWith("https://git.example.org/fork", "inner");
  assert.equal(
    m.sourceRepoFileHref("docs/architecture/self-hosting.md"),
    "https://git.example.org/fork/blob/main/docs/architecture/self-hosting.md"
  );
});

test("sourceRepoHref: a blank/whitespace configuration falls back to the upstream repo", async () => {
  // `?.trim() || DEFAULT` — an operator who exports the variable empty (a common
  // shape in a .env or a Helm value that was templated to nothing) must still get a
  // working source link, because the licence notice cannot degrade to "".
  const blank = await loadWith("   ", "blank");
  assert.equal(blank.sourceRepoHref(), "https://github.com/xkazm04/kp");
  const unset = await loadWith(undefined, "unset");
  assert.equal(unset.sourceRepoHref(), "https://github.com/xkazm04/kp");
  assert.equal(unset.sourceRepoFileHref("LICENSE"), "https://github.com/xkazm04/kp/blob/main/LICENSE");
});

test("sourceRepoHref: a configured URL is returned verbatim (the root destination)", async () => {
  const m = await loadWith("https://git.example.org/fork", "root");
  assert.equal(m.sourceRepoHref(), "https://git.example.org/fork");
  assert.equal(m.SOURCE_REPO_URL, "https://git.example.org/fork");
});
