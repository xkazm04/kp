// The dock's pure decisions. Runner: node:test with type stripping —
// `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  companionRetryTarget,
  readProposalAnswer,
  withoutOptimisticTurns,
} from "./companion-dock-states.ts";
import type { CompanionProposal } from "./db/companion.ts";

const ROW = { id: "p1", status: "accepted" } as unknown as CompanionProposal;

test("a refused proposal answer that carries the server's row closes the card", () => {
  const answer = readProposalAnswer({ proposal: ROW, code: "COMPANION_PROPOSAL_RESOLVED" });
  assert.equal(answer.proposal, ROW, "the row wins over the status");
  assert.equal(answer.code, null, "…and it is not also reported as a failure");
});

test("a code with no row is a real failure the card must say", () => {
  assert.deepEqual(readProposalAnswer({ code: "TOO_MANY_REQUESTS" }), {
    proposal: null,
    code: "TOO_MANY_REQUESTS",
  });
  assert.deepEqual(readProposalAnswer({}), { proposal: null, code: "COMPANION_PROPOSAL_FAILED" });
  assert.deepEqual(readProposalAnswer(null), { proposal: null, code: "COMPANION_PROPOSAL_FAILED" });
});

test("retry drops the unsent bubbles and keeps the stored ones", () => {
  const turns = [{ id: "t1" }, { id: "optimistic-1" }, { id: "optimistic-2" }];
  assert.deepEqual(withoutOptimisticTurns(turns), [{ id: "t1" }]);
});

test("the error line offers a boot retry before the thread exists, a message retry after", () => {
  assert.equal(companionRetryTarget({ ready: false, error: "COMPANION_THREADS_FAILED", lastFailed: null }), "boot");
  assert.equal(companionRetryTarget({ ready: false, error: null, lastFailed: null }), null);
  assert.equal(companionRetryTarget({ ready: true, error: "TOO_MANY_REQUESTS", lastFailed: "hi" }), "message");
  assert.equal(companionRetryTarget({ ready: true, error: null, lastFailed: null }), null);
});

test("a failed send is drawn ONCE: the bubble stays and the composer does not restore it", () => {
  const body = readFileSync(
    fileURLToPath(new URL("../features/shell/companion/CompanionDockBody.tsx", import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n");
  // Both halves fired before: the optimistic bubble stayed AND the composer put
  // the same text back, so one refused message was on screen twice and Enter
  // re-asked the question the failed bubble was already showing.
  assert.match(body, /restoreDraftOnFailure=\{false\}/, "the dock's composer must not restore the refused draft");

  const hook = readFileSync(
    fileURLToPath(new URL("../features/shell/companion/useCompanionThread.ts", import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n");
  assert.match(
    hook,
    /setTurns\(withoutOptimisticTurns\)/,
    "retry must drop the unsent bubbles before send pushes a fresh one, or the message is drawn twice",
  );
});

test("the dock takes focus into the composer when it opens", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../features/shell/companion/CompanionDock.tsx", import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n");
  // Not reachable from node:test (no DOM, and the dock is a client tree), so the
  // call itself is pinned: opening the window used to leave the caret on <body>,
  // so a keyboard operator tabbed in from the top of the page every time.
  assert.match(src, /const composerRef = useRef<HTMLTextAreaElement \| null>\(null\);/, "the dock owns the composer ref");
  assert.match(src, /composerRef\.current\?\.focus\(\)/, "opening the dock must move focus into the composer");
  assert.match(src, /composerRef=\{composerRef\}/, "…and the ref must reach the body");
});

test("the composer is dead until the thread exists, and a failed boot offers a re-boot", () => {
  const body = readFileSync(
    fileURLToPath(new URL("../features/shell/companion/CompanionDockBody.tsx", import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n");
  // The dock passed `busy` and never `ready`, so after a failed boot the composer
  // was live and every send returned false into nothing at all.
  assert.match(body, /composerDisabled=\{!ready\}/, "the composer must be disabled until the thread has booted");
  assert.match(body, /companionRetryTarget\(/, "the error line's offer is the tested decision, not an inline guess");

  const hook = readFileSync(
    fileURLToPath(new URL("../features/shell/companion/useCompanionThread.ts", import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n");
  assert.match(hook, /setBootAttempt\(/, "retry before a thread exists must re-run the boot request");
});
