// lens-sweep round 2 (bug-hunter, context voice-ui-components).
//
// `micErrorText` is the ONE classifier three surfaces share — the candidate voice
// interview (`VoiceInterview.tsx`), the pre-call mic test (`useMicTest.ts`) and the
// JD intake voice surface (`voicePhase.ts::micFailure`). Its DOMException-name table
// is precise. Its MESSAGE fallback was not: `/permission|denied|dismiss/i` matched a
// bare "denied" anywhere in arbitrary text.
//
// That fallback is reached with provider text, not just with getUserMedia text. The
// ElevenLabs path hands it `cause ?? message` where `message` is the SDK's own English
// string (`VoiceInterview.tsx:470`), so an auth or agent-access failure reading
// "Agent access denied" rendered `errMicDenied` — "click the microphone icon in your
// address bar" — for a failure the candidate cannot fix that way, and which the whole
// point of the fallback (`?? t("errVoiceSession")`) would otherwise have described
// honestly. On the intake surface the same string turned a transport fault into a
// `{ kind: "mic" }` verdict with a recovery step that does nothing.
//
// The name table is what classifies a REAL browser denial, and it still does. The
// message fallback now only matches the phrases getUserMedia itself produces.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { micErrorText } from "./micErrorText.ts";

const COPY = { denied: "DENIED", notFound: "NOT_FOUND", busy: "BUSY" };

// A real DOMException, which is what a browser's getUserMedia rejects with — node has
// the constructor, so the name table can be driven exactly as it is in production
// rather than through the name-on-a-plain-Error stand-in the sibling
// mic-test-state.test.ts uses.
const dom = (name: string, message = "") => new DOMException(message, name);

test("a real getUserMedia denial is still classified by its DOMException name", () => {
  assert.equal(micErrorText(dom("NotAllowedError", "Permission denied"), COPY), "DENIED");
  assert.equal(micErrorText(dom("SecurityError"), COPY), "DENIED", "a name with no message must still classify");
  assert.equal(micErrorText(dom("NotFoundError", "Requested device not found"), COPY), "NOT_FOUND");
  assert.equal(micErrorText(dom("NotReadableError", "Device in use"), COPY), "BUSY");
  assert.equal(micErrorText(dom("OverconstrainedError"), COPY), "NOT_FOUND");
  assert.equal(micErrorText(dom("AbortError"), COPY), "BUSY");
});

test("a nameless getUserMedia rejection is still classified by its own message", () => {
  // A relayed or serialized rejection that lost its DOMException name — the reason the
  // message fallback exists at all. These are the phrases the browser itself emits.
  assert.equal(micErrorText(new Error("Permission denied"), COPY), "DENIED");
  assert.equal(micErrorText(new Error("Permission dismissed"), COPY), "DENIED");
  assert.equal(micErrorText(new Error("Requested device not found"), COPY), "NOT_FOUND");
  assert.equal(micErrorText(new Error("Device already in use"), COPY), "BUSY");
});

test("a provider failure that merely contains the word 'denied' is NOT a mic denial", () => {
  // The defect, stated: these are auth / agent-access failures relayed by the
  // ElevenLabs SDK. Returning null is what lets the caller show its own session
  // error instead of a microphone recovery step the candidate cannot act on.
  assert.equal(micErrorText(new Error("Agent access denied"), COPY), null);
  assert.equal(micErrorText(new Error("Access to this conversation was denied"), COPY), null);
  assert.equal(micErrorText("Signed URL rejected: access denied", COPY), null);
  assert.equal(micErrorText(new Error("401 Unauthorized"), COPY), null);
});

test("an unrelated failure classifies as nothing, so the caller can speak for itself", () => {
  assert.equal(micErrorText(new Error("something else entirely"), COPY), null);
  assert.equal(micErrorText(null, COPY), null);
  assert.equal(micErrorText(undefined, COPY), null);
});
