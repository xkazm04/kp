import test from "node:test";
import assert from "node:assert/strict";
import { derivePostingLifecycle } from "./jobsPostingLifecycle.ts";

// The modal's publish / close / reopen state machine, extracted from
// jobsPostingModalLogic so it can be pinned: the in-session flips layer over the
// server-decorated job.status, and the footer hands out apply links from the
// answer. A draft's apply pages 404 and a closed role's serve 410, so getting
// this wrong ships a campaign pointing at nothing.

test("with no in-session transition the server's status stands", () => {
  assert.deepEqual(derivePostingLifecycle("draft", false, false), { status: "draft", isDraft: true, isClosed: false });
  assert.deepEqual(derivePostingLifecycle("published", false, false), { status: "published", isDraft: false, isClosed: false });
  assert.deepEqual(derivePostingLifecycle(null, false, false), { status: null, isDraft: false, isClosed: false });
});

test("publishing a draft flips it live without a refetch", () => {
  assert.deepEqual(derivePostingLifecycle("draft", false, true), {
    status: "published",
    isDraft: false,
    isClosed: false,
  });
});

test("closing wins over the server status", () => {
  assert.equal(derivePostingLifecycle("published", true, false).isClosed, true);
});

test("reopen: a re-publish after a close is live again — closed must not win by order", () => {
  // The bug this pins: `closed ? "closed" : published ? …` reads closed FIRST, so
  // the reopen path has to clear the closed flag as it sets published. If a future
  // edit forgets, the footer keeps the links inert on a role that is live.
  assert.deepEqual(derivePostingLifecycle("closed", false, true), {
    status: "published",
    isDraft: false,
    isClosed: false,
  });
});

test("a closed role with no in-session flip stays closed", () => {
  assert.deepEqual(derivePostingLifecycle("closed", false, false), {
    status: "closed",
    isDraft: false,
    isClosed: true,
  });
});
