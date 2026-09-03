// The webhook config is ONE shared document and it used to be a whole-document,
// last-writer-wins write: `setAtsConfig` resolved an omitted `webhookUrl`/`events` to
// null/[], so the panel had to resend everything on every save. Two operators (or two
// tabs) editing side by side therefore clobbered each other silently — the second save
// wrote the event subscriptions the FIRST tab had loaded, and nothing said so.
//
// This pins the two halves of the fix:
//   • PARTIAL updates — an omitted field keeps what is stored (the contract the inbound
//     ATS panel next to it already had).
//   • OPTIMISTIC CONCURRENCY — `version` rides on the public view, and a write that
//     echoes a version the store has moved past is REFUSED (AtsConfigStaleError, a 409)
//     rather than applied over the other operator's save.
//
// NON-VACUITY (verified by running this file against the pre-change store):
//   • `getAtsConfig().version` did not exist → the version assertions fail.
//   • an omitted `events` wrote `[]` → the "keeps the stored subscriptions" assertion fails.
//   • `expectedVersion` was ignored → the stale write LANDED, so `assert.throws` fails and
//     the surviving row is the loser's.
//
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { AtsConfigError, AtsConfigStaleError, getAtsConfig, setAtsConfig } from "./ats-config-store.ts";

const A = "https://hooks.example.com/tab-a";
const B = "https://hooks.example.com/tab-b";

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  // Reset the single row to a known baseline WITHOUT an expectedVersion (a
  // server-internal write has no read to be stale about).
  setAtsConfig({ webhookUrl: null, events: [], webhookSecret: "" });
});
after(() => cleanupUnitDb());

test("every accepted write bumps the version the public view carries", () => {
  const before = getAtsConfig().version;
  setAtsConfig({ webhookUrl: A, events: ["candidate.hired"] });
  const after1 = getAtsConfig();
  assert.equal(after1.version, before + 1);
  assert.equal(after1.webhookUrl, A);
  setAtsConfig({ events: ["candidate.hired", "offer.accepted"] });
  assert.equal(getAtsConfig().version, before + 2);
});

test("an omitted field is KEPT, not cleared — the write is partial, not whole-document", () => {
  setAtsConfig({ webhookUrl: A, events: ["candidate.hired", "candidate.rejected"] });

  // Change only the URL: the subscriptions must survive.
  setAtsConfig({ webhookUrl: B });
  let cfg = getAtsConfig();
  assert.equal(cfg.webhookUrl, B);
  assert.deepEqual(cfg.events, ["candidate.hired", "candidate.rejected"]);

  // Change only the events: the endpoint must survive.
  setAtsConfig({ events: ["offer.declined"] });
  cfg = getAtsConfig();
  assert.equal(cfg.webhookUrl, B, "an events-only save must not disable delivery");
  assert.deepEqual(cfg.events, ["offer.declined"]);

  // An EXPLICIT empty string still means "disable" — the deliberate clear is intact.
  setAtsConfig({ webhookUrl: "" });
  assert.equal(getAtsConfig().webhookUrl, null);
});

test("THE RACE: the loser's save is refused, and the winner's config is what survives", () => {
  // Both operators load the same config.
  setAtsConfig({ webhookUrl: A, events: ["candidate.hired"] });
  const readByBoth = getAtsConfig();

  // Operator 1 saves first, echoing the version they read.
  setAtsConfig({ webhookUrl: A, events: ["candidate.hired", "offer.accepted"], expectedVersion: readByBoth.version });

  // Operator 2's save was composed against the config BEFORE that landed. Pre-fix it
  // silently overwrote operator 1's subscriptions; now it is refused.
  assert.throws(
    () => setAtsConfig({ webhookUrl: B, events: ["candidate.rejected"], expectedVersion: readByBoth.version }),
    (e: unknown) => e instanceof AtsConfigStaleError && e instanceof AtsConfigError,
    "a save built on a superseded read must be refused, not applied",
  );

  // Nothing of the loser's write reached the row.
  const survived = getAtsConfig();
  assert.equal(survived.webhookUrl, A);
  assert.deepEqual(survived.events, ["candidate.hired", "offer.accepted"]);

  // …and re-reading lets operator 2 retry against the current version.
  setAtsConfig({ webhookUrl: B, expectedVersion: survived.version });
  assert.equal(getAtsConfig().webhookUrl, B);
});

test("a write with no expectedVersion still lands (server-internal writes have no read to be stale about)", () => {
  setAtsConfig({ webhookUrl: A, events: ["candidate.hired"] });
  setAtsConfig({ webhookUrl: B });
  assert.equal(getAtsConfig().webhookUrl, B);
});

test("a malformed expectedVersion is a validation refusal, not a silent unversioned write", () => {
  setAtsConfig({ webhookUrl: A, events: [] });
  const before = getAtsConfig();
  assert.throws(() => setAtsConfig({ webhookUrl: B, expectedVersion: "soon" }), AtsConfigError);
  assert.throws(() => setAtsConfig({ webhookUrl: B, expectedVersion: -1 }), AtsConfigError);
  assert.deepEqual(getAtsConfig(), before, "nothing may be written on a refused version");
});
