// The companion mic is not a placeholder any more, and this is what keeps it
// from becoming one again.
//
// A source guard rather than a render test because what is being pinned is a
// WIRING decision, not an output: the control was drawn `disabled` over a
// complete `/api/stt` route for as long as nobody connected the two, and the way
// that regresses is a refactor that keeps the icon and drops the hook. There is
// no DOM in this runner and `useStt` needs `MediaRecorder`, `getUserMedia` and a
// real `AudioContext`, so the behaviour itself is verified in a browser; these
// assertions are the part a gate can hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The checkout is CRLF on Windows and LF in the shared worktree; a guard that
// regex-parses source normalizes first or it passes in one tree and fails in the
// other.
const source = readFileSync(new URL("./CompanionInputPanel.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the mic is wired to the STT hook, not drawn disabled", () => {
  assert.match(source, /import \{ useStt \} from "@\/packages\/voice-stt\/src\/react\/useStt"/);
  assert.match(source, /onClick=\{stt\.toggle\}/);
  // The placeholder's exact shape: a `disabled` attribute with no expression,
  // which is how a control is switched off permanently rather than for a state.
  assert.doesNotMatch(source, /\n\s+disabled\n/, "a bare `disabled` attribute is the placeholder shape");
});

test("a recording dictates into the composer instead of sending", () => {
  // Appending, not replacing, and NOT calling submit: a mis-heard word has to be
  // fixable before Candi sees it.
  assert.match(source, /onTranscript: acceptTranscript/);
  assert.match(source, /setDraft\(\(current\) => \(current\.trim\(\)/);
});

test("the press has two meanings and announces which", () => {
  assert.match(source, /aria-pressed=\{recording\}/);
  assert.match(source, /voiceMode\.micStop/);
});

test("a refusal is rendered from its CODE, in the reader's language", () => {
  // Never `stt.error`, which is the route's canonical English.
  assert.match(source, /resolveError\(\{ code: stt\.errorCode \}/);
  assert.doesNotMatch(source, /\{stt\.error\}/);
});

test("an install with no engine says so and stops offering the control", () => {
  // STT_UNAVAILABLE is a server-configuration fact: recording into the same 503
  // a second time cannot help, and a live-looking control that always fails is
  // the placeholder problem in a new costume.
  assert.match(source, /stt\.unavailable/);
  assert.match(source, /disabled=\{stt\.busy \|\| stt\.unavailable\}/);
  assert.match(source, /voiceMode\.micUnavailable/);
});

test("no raw color reaches the mic: both themes resolve through tokens", () => {
  // design:check owns this repo-wide; asserted here too because the recording
  // state is the one place a red "REC" hex is the obvious thing to reach for.
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(source, /bg-coral\/10 text-coral/);
});
