import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// capst-l1-002 (backlog 32) — the quick-apply flow must end with STATUS
// VISIBILITY, like the conversational path always has: the POST returns the
// entry's status token, the done screen renders the /status/<token> link, and
// the acknowledgement carries the same link. Source-contract test (the
// repo pattern for wiring that unit-level calls can't reach): pins the exact
// references so a refactor that drops the link fails here, not in UAT.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("quick-apply done screen renders the status link", () => {
  const src = read("QuickApplyForm.tsx");
  assert.match(src, /statusToken/, "the done state carries the statusToken from the POST response");
  assert.match(src, /\/status\/\$\{done\.statusToken\}/, "the done screen links to /status/<token>");
  assert.match(src, /t\("trackStatus"\)/, "the link uses the shared apply.trackStatus label");
});

test("quick-apply POST returns the status token and threads the status link into the ack", () => {
  const src = read("../../../api/apply/[id]/quick/route.ts");
  assert.match(src, /getOrCreateStatusLink/, "the route mints/reuses the entry's status token");
  assert.match(src, /statusLinkFor/, "the ack email gets the ABSOLUTE status link via lead-intake");
  assert.match(src, /statusToken,?\s*\n?\s*\}\);|statusToken,/, "accept responses carry statusToken");
});

test("the emailed status links are pinned to the language the candidate applied in", () => {
  // The ack email is read OUTSIDE the app, where no NEXT_LOCALE cookie exists —
  // a bare /status/<token> drops a Czech applicant onto an English page. Both
  // public apply routes must carry ?lang=, the same convention enrichLink uses
  // (proxy.ts translates it back into the cookie).
  const quick = read("../../../api/apply/[id]/quick/route.ts");
  assert.match(
    quick,
    /\/status\/\$\{token\}\?lang=\$\{applicantLocale\}/,
    "quick-apply's statusLinkFor pins ?lang=<applicantLocale>"
  );
  const conversational = read("../../../api/apply/[id]/route.ts");
  assert.match(
    conversational,
    /\/status\/\$\{statusToken\}\?lang=\$\{applicantLocale\}/,
    "the conversational route's ack statusLink pins ?lang=<applicantLocale>"
  );
});

test("the status page gives the candidate a way back to their own language", () => {
  // The one candidate surface with no chrome at all: a forwarded link or a stale
  // cookie can still land them in a language they don't read.
  const src = read("../../../status/[token]/StatusClient.tsx");
  assert.match(src, /LanguageSwitcher/, "the status page renders the shared LanguageSwitcher");
});

test("quick-apply accepted copy is honest about delivery capability (REC-10)", () => {
  const src = read("../../../api/apply/[id]/quick/route.ts");
  assert.match(
    src,
    /isRelayConfigured\(\)\s*\?\s*"quick\.acceptedMessage"\s*:\s*"quick\.acceptedMessageNoRelay"/,
    "\"We've emailed you\" is only claimed when a relay actually delivers"
  );
});

test("lead-intake attaches the status link to every acknowledgement it dispatches", () => {
  const src = read("../../../_lib/lead-intake.ts");
  assert.match(src, /statusLinkFor\?\:\s*\(entryId: string\) => string \| null/, "the input contract exposes statusLinkFor");
  assert.match(src, /statusLink \? \{ statusLink \} : undefined/, "the ack passes statusLink to dispatchApplicationReceived");
});
