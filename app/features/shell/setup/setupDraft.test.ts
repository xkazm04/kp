import test from "node:test";
import assert from "node:assert/strict";
import {
  draftFromState,
  draftIsEmpty,
  mergeSetupDraft,
  parseSetupDraft,
  restoredStepIndex,
  setupDraftKey,
  type SetupDraft,
} from "./setupDraft";
import { INITIAL_SETUP, SETUP_STEPS, type SetupState } from "./setupSteps";

// The wizard used to hold everything in plain useState, so a reload three steps
// in threw away the org name, the accent, the logo, every staged invite and the
// board draft — and the '/' gate re-opened it at step 0, empty. These pin the two
// rules that make restoring safe: whose slot it is, and what wins on a merge.

const EN: SetupState = { ...INITIAL_SETUP };

function draft(over: Partial<SetupDraft> = {}): SetupDraft {
  return {
    orgName: "Acme",
    language: "cs",
    accentColor: "#3f6f4f",
    logoUrl: "https://acme.test/logo.svg",
    invites: [{ email: "jana@acme.com", role: "recruiter" }],
    companionChoice: "birth",
    axisDraft: null,
    stepIndex: 2,
    maxVisited: 3,
    ...over,
  };
}

/* ── keying ───────────────────────────────────────────────────────────────── */

test("one slot per principal", () => {
  assert.notEqual(setupDraftKey("u:u_1"), setupDraftKey("u:u_2"));
  assert.equal(setupDraftKey("u:u_1"), "kp-setup-draft:u:u_1");
});

test("an identity-less session gets its OWN slot, never a shared keyless one", () => {
  // sessionStorage survives a logout/login inside one tab: "we don't know who
  // this is" must not read the same slot as "this is u_1".
  assert.equal(setupDraftKey(null), "kp-setup-draft:anonymous");
  assert.equal(setupDraftKey("   "), setupDraftKey(null));
  assert.notEqual(setupDraftKey(null), setupDraftKey("u:u_1"));
});

/* ── merge ────────────────────────────────────────────────────────────────── */

test("an untouched mount takes the whole draft", () => {
  const merged = mergeSetupDraft(EN, draft(), EN);
  assert.equal(merged.orgName, "Acme");
  assert.equal(merged.language, "cs");
  assert.equal(merged.accentColor, "#3f6f4f");
  assert.deepEqual(merged.invites, [{ email: "jana@acme.com", role: "recruiter" }]);
  assert.equal(merged.companionChoice, "birth");
});

test("TYPING WINS: a keystroke that beat the scope probe is not overwritten", () => {
  const live: SetupState = { ...EN, orgName: "Typed First" };
  assert.equal(mergeSetupDraft(live, draft(), EN).orgName, "Typed First");
  // …and the fields the operator has not answered still restore.
  assert.equal(mergeSetupDraft(live, draft(), EN).language, "cs");
});

test("an invite staged in this mount is not replaced by the stored list", () => {
  const live: SetupState = { ...EN, invites: [{ email: "new@acme.com", role: "admin" }] };
  assert.deepEqual(mergeSetupDraft(live, draft(), EN).invites, [{ email: "new@acme.com", role: "admin" }]);
});

test("the seeded language is the baseline, so a switch made in this mount survives", () => {
  // `language` is seeded from the running locale, not from INITIAL_SETUP.
  const seeded: SetupState = { ...EN, language: "de" };
  assert.equal(mergeSetupDraft(seeded, draft(), seeded).language, "cs");
  const switched: SetupState = { ...seeded, language: "fr" };
  assert.equal(mergeSetupDraft(switched, draft(), seeded).language, "fr");
});

test("no draft is a no-op, and the server-owned pipeline is never merged", () => {
  assert.equal(mergeSetupDraft(EN, null, EN), EN);
  const withBoard: SetupState = { ...EN, pipelineLoad: "ready" };
  assert.equal(mergeSetupDraft(withBoard, draft(), EN).pipeline, null);
  assert.equal(mergeSetupDraft(withBoard, draft(), EN).pipelineLoad, "ready");
});

/* ── parse ────────────────────────────────────────────────────────────────── */

test("a corrupt or foreign slot is a missing slot, never poisoned state", () => {
  assert.equal(parseSetupDraft(null, EN), null);
  assert.equal(parseSetupDraft("{not json", EN), null);
  assert.equal(parseSetupDraft('"a string"', EN), null);
});

test("an invite at a role that is not a MemberRole is dropped, not forwarded to the server", () => {
  const raw = JSON.stringify({ invites: [{ email: "a@b.c", role: "wizard" }, { email: "d@e.f", role: "admin" }] });
  assert.deepEqual(parseSetupDraft(raw, EN)?.invites, [{ email: "d@e.f", role: "admin" }]);
});

test("a nonsense companion choice reads as 'skip for now'", () => {
  assert.equal(parseSetupDraft(JSON.stringify({ companionChoice: "delete-everything" }), EN)?.companionChoice, null);
  assert.equal(parseSetupDraft(JSON.stringify({ companionChoice: "connect" }), EN)?.companionChoice, "connect");
});

test("round-trips what the wizard holds", () => {
  const state: SetupState = { ...EN, orgName: "Acme", invites: [{ email: "jana@acme.com", role: "recruiter" }] };
  const parsed = parseSetupDraft(JSON.stringify(draftFromState(state, 2, 3)), EN);
  assert.equal(parsed?.orgName, "Acme");
  assert.equal(parsed?.stepIndex, 2);
  assert.equal(parsed?.maxVisited, 3);
  assert.deepEqual(parsed?.invites, [{ email: "jana@acme.com", role: "recruiter" }]);
});

test("an untouched first run stores nothing", () => {
  assert.equal(draftIsEmpty(draftFromState(EN, 0, 0)), true);
  assert.equal(draftIsEmpty(draftFromState({ ...EN, orgName: "A" }, 0, 0)), false);
  assert.equal(draftIsEmpty(draftFromState(EN, 2, 2)), false);
});

/* ── resume point ─────────────────────────────────────────────────────────── */

test("a draft cannot resume past the steps that exist", () => {
  const at = restoredStepIndex(draft({ stepIndex: 99, maxVisited: 99 }), SETUP_STEPS.length);
  assert.equal(at.stepIndex, SETUP_STEPS.length - 1);
  assert.equal(at.maxVisited, SETUP_STEPS.length - 1);
});

test("a draft cannot resume above the ceiling it recorded", () => {
  const at = restoredStepIndex(draft({ stepIndex: 4, maxVisited: 1 }), SETUP_STEPS.length);
  // Reaching step 4 IS the proof the mark should have been 4 — the two are
  // reconciled upward, never by opening a step the mark never bought.
  assert.equal(at.maxVisited, 4);
  assert.equal(at.stepIndex, 4);
  const back = restoredStepIndex(draft({ stepIndex: 1, maxVisited: 3 }), SETUP_STEPS.length);
  assert.deepEqual(back, { stepIndex: 1, maxVisited: 3 });
});
