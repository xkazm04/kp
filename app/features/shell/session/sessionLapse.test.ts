// The lapse contract of the workspace shell, pinned as pure decisions: when a
// signed session is live, when it warns, when it has lapsed, and what an in-place
// re-sign-in must do next (resume, switch back to the team, or reload because a
// different person signed in). The dialog and the hook are thin wiring over these.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WARN_BEFORE_MS,
  lapseOnStatus,
  phaseAt,
  reconcileRead,
  resolveReauth,
  resolveSwitch,
  type SessionFacts,
} from "./sessionLapse.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const user = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  kind: "user",
  userId: "u-1",
  email: "ada@example.com",
  workspaceId: "ws-a",
  expiresAt: NOW + 2 * 60 * MIN,
  ...over,
});

test("open mode never lapses: live at any clock, no timer armed", () => {
  for (const at of [NOW, NOW + 7 * 24 * 60 * MIN, NOW + 10 ** 12]) {
    const p = phaseAt({ passwordMode: false, session: null }, at);
    assert.equal(p.phase, "live");
    assert.equal(p.nextCheckAt, null);
  }
  // A password-mode document with no signed session (demo / anonymous) has nothing to watch either.
  assert.deepEqual(phaseAt({ passwordMode: true, session: null }, NOW), { phase: "live", nextCheckAt: null });
});

test("a session nine minutes from expiry is expiring, with the minutes left", () => {
  const p = phaseAt({ passwordMode: true, session: user({ expiresAt: NOW + 9 * MIN }) }, NOW);
  assert.equal(p.phase, "expiring");
  assert.equal(p.phase === "expiring" && p.minutesLeft, 9);
  // Re-checked when the minute count changes, never later than expiry.
  assert.equal(p.nextCheckAt, NOW + MIN);
});

test("a session two hours out is live and re-checks ten minutes before expiry", () => {
  const expiresAt = NOW + 2 * 60 * MIN;
  const p = phaseAt({ passwordMode: true, session: user({ expiresAt }) }, NOW);
  assert.deepEqual(p, { phase: "live", nextCheckAt: expiresAt - WARN_BEFORE_MS });
  assert.equal(WARN_BEFORE_MS, 10 * MIN);
});

test("at or past expiry the session has lapsed", () => {
  const expiresAt = NOW;
  assert.equal(phaseAt({ passwordMode: true, session: user({ expiresAt }) }, NOW).phase, "lapsed");
  assert.equal(phaseAt({ passwordMode: true, session: user({ expiresAt }) }, NOW + 1).phase, "lapsed");
});

test("only a 401 lapses a live session; a 403 is under-privilege, a 500 is an outage", () => {
  assert.equal(lapseOnStatus("live", 401), "lapsed");
  assert.equal(lapseOnStatus("expiring", 401), "lapsed");
  assert.equal(lapseOnStatus("live", 403), "live");
  assert.equal(lapseOnStatus("live", 500), "live");
  assert.equal(lapseOnStatus("expiring", 200), "expiring");
});

test("re-sign-in as the same person on the same team resumes in place", () => {
  assert.deepEqual(resolveReauth(user(), user({ expiresAt: NOW + 7 * 24 * 60 * MIN })), { action: "resume" });
});

test("re-sign-in as the same person that landed on another team switches back", () => {
  assert.deepEqual(resolveReauth(user({ workspaceId: "ws-a" }), user({ workspaceId: "ws-b" })), {
    action: "switch",
    workspaceId: "ws-a",
  });
});

test("a different person (or kind) signing in reloads — the page state was someone else's", () => {
  assert.deepEqual(resolveReauth(user(), user({ userId: "u-2", email: "bob@example.com" })), { action: "reload" });
  const operator: SessionFacts = { kind: "operator", userId: null, email: null, workspaceId: "ws-a", expiresAt: NOW + MIN };
  assert.deepEqual(resolveReauth(user(), operator), { action: "reload" });
  assert.deepEqual(resolveReauth(operator, user()), { action: "reload" });
  // No fresh session at all after a "successful" sign-in: never resume on faith.
  assert.deepEqual(resolveReauth(user(), null), { action: "reload" });
});

test("the operator re-signing in resumes (same kind, no user id on either side)", () => {
  const operator: SessionFacts = { kind: "operator", userId: null, email: null, workspaceId: "workspace", expiresAt: NOW };
  assert.deepEqual(resolveReauth(operator, { ...operator, expiresAt: NOW + MIN }), { action: "resume" });
});

test("the switch back: 200 resumes; a membership gone meanwhile (403/404) reloads to '/'", () => {
  assert.equal(resolveSwitch(200), "resume");
  assert.equal(resolveSwitch(403), "reload");
  assert.equal(resolveSwitch(404), "reload");
  assert.equal(resolveSwitch(401), "reload");
  assert.equal(resolveSwitch(500), "reload");
});

test("a re-read decides the lapse, not the local clock alone", () => {
  const armed = user({ expiresAt: NOW });
  // 401 on the caller's own read: lapsed.
  assert.deepEqual(reconcileRead(armed, { status: 401 }), { lapsed: true, session: armed });
  // Another tab re-signed in: the server holds a later expiry — adopt it, stay live.
  const later = user({ expiresAt: NOW + 7 * 24 * 60 * MIN });
  assert.deepEqual(reconcileRead(armed, { status: 200, session: later }), { lapsed: false, session: later });
  // The signed session is gone while a 200 still came back (cookie cleared elsewhere).
  assert.deepEqual(reconcileRead(armed, { status: 200, session: null }), { lapsed: true, session: armed });
  // An outage is not a lapse: keep what we had.
  assert.deepEqual(reconcileRead(armed, { status: 503 }), { lapsed: false, session: armed });
  // Nothing armed (open mode): a read can arm it, never lapse it.
  assert.deepEqual(reconcileRead(null, { status: 200, session: null }), { lapsed: false, session: null });
  assert.deepEqual(reconcileRead(null, { status: 401 }), { lapsed: false, session: null });
});
