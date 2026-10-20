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
  assert.match(src, /const statusPath = done\.statusToken \? `\/status\/\$\{encodeURIComponent\(done\.statusToken\)\}` : null/, "the done screen builds a safe /status/<token> path");
  assert.match(src, /href=\{statusPath\}/, "the done screen links to the status path");
  assert.match(src, /t\("trackStatus"\)/, "the link uses the shared apply.trackStatus label");
});

test("quick-apply POST returns the status token and threads the status link into the ack", () => {
  const src = read("../../../api/apply/[id]/quick/route.ts");
  // Minted through the filing core's ONE best-effort helper (safeStatusToken over
  // getOrCreateStatusLink) since challenge 2026-09-22 candidate-apply-api/A; the route
  // used to carry its own copy of that helper beside the conversational route's.
  assert.match(src, /import \{ safeStatusToken \} from "@\/app\/_lib\/application-filing"/, "the route mints/reuses the entry's status token via the core");
  assert.match(src, /const statusToken = safeStatusToken\(outcome\.entryId\)/, "the fresh accept mints it for its own entry");
  assert.doesNotMatch(src, /function safeStatus(Token|Link)\(/, "no private copy of the mint");
  assert.match(read("../../../_lib/application-filing.ts"), /return getOrCreateStatusLink\(entryId\);/, "the core's helper reuses the entry's token");
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
  // One statusLinkFor serves the first ack AND the newly-reachable re-ack now (the
  // core's ack seam calls it for both): the entry's own locale, which on a first
  // filing IS the applied-in one, falling back to it.
  assert.match(
    conversational,
    /\/status\/\$\{token\}\?lang=\$\{entry\.locale \|\| applicantLocale\}/,
    "the conversational route's ack statusLink pins ?lang="
  );
  // The old defect, forbidden on both routes: a bare status link with no ?lang=.
  for (const src of [quick, conversational]) {
    assert.doesNotMatch(src, /\/status\/\$\{\w+\}`/, "a status link without ?lang= drops the candidate on the wrong language");
  }
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
  // The lead core files (and acknowledges) through application-filing.ts, handing it
  // the caller's link maker; the core's ONE ack seam attaches it to every ack it
  // sends — the first one and the newly-reachable re-ack alike.
  assert.match(src, /statusLinkFor: input\.statusLinkFor \? \(entry\) => input\.statusLinkFor\?\.\(entry\.id\) \?\? null : undefined/, "the lead core forwards statusLinkFor to the filing core");
  const core = read("../../../_lib/application-filing.ts");
  assert.match(core, /const statusLink = input\.statusLinkFor\?\.\(entry\) \?\? null;/, "the core mints it for every ack kind");
  assert.match(core, /statusLink \? \{ statusLink \} : undefined/, "the ack passes statusLink to dispatchApplicationReceived");
});
