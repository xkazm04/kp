// THE SCHEDULE DOOR SPEAKS THE CANDIDATE'S LANGUAGE (/perfect,
// schedule-door-speaks-the-candidates-language).
//
// Every other candidate link in the product is pinned to the language its LETTER is
// written in — the status link in the application ack (app/api/apply/[id]/route.ts), the
// erasure link in every candidate comm (comms-dispatch.ts), the voice-interview link
// (app/api/interview/create/route.ts) and the offer link (offer-link-locale.test.ts).
// The scheduling invite was the one that was not: an ABSOLUTE link opened from an email
// carries no NEXT_LOCALE cookie, so unpinned it resolved from Accept-Language and dropped
// a Czech candidate who had just read a Czech invitation onto an English booking page —
// on the step where they have to understand a date, a duration and a timezone.
//
// Source-contract, the repo pattern for wiring a unit test cannot reach without booting
// the comms + DB stack (offer-link-locale.test.ts is the same shape): the pin must happen
// where the link is BUILT, from the entry the letter's own locale is resolved from, and
// the page must carry the shared LanguageSwitcher as the escape hatch for a forwarded
// link or a stale cookie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("the minted invite link is pinned to the candidate's own locale", () => {
  const src = read("../../api/schedule/invite/route.ts");
  assert.match(
    src,
    /const link = pinLinkLocale\(\s*`\$\{publicBaseUrl\(new URL\(request\.url\)\.origin\)\}\/schedule\/\$\{invite\.token\}`,\s*resolveCommsLocale\(entry\.locale, entry\.workspaceId \?\? undefined\)\s*\)/,
    "the EMAILED link must be pinned from the same entry the letter's locale is resolved from"
  );
  // …and the recruiter's own copy of it must NOT be: ?lang= on a link the recruiter opens
  // rewrites their NEXT_LOCALE cookie and flips the whole console's language.
  assert.match(
    src,
    /url: `\/schedule\/\$\{invite\.token\}`/,
    "the recruiter-facing url stays bare — the same rule /api/interview/create states"
  );
});

test("the reschedule link inside the confirmation email is pinned too", () => {
  // The candidate's one durable way back after the tab closes. It rides in the SAME
  // letter as the confirmation, so an unpinned copy of it re-opens the English page the
  // invite pin had just avoided.
  const src = read("../../api/schedule/[token]/route.ts");
  assert.match(
    src,
    /rescheduleLink: pinLinkLocale\(/,
    "the confirmation email's reschedule link must carry the candidate's language"
  );
  assert.match(src, /resolveCommsLocale\(entry\.locale, entry\.workspaceId \?\? undefined\)/);
});

test("the booking page gives the candidate a way back to their own language", () => {
  const src = read("page.tsx");
  assert.match(
    src,
    /LanguageSwitcher/,
    "the schedule page renders the shared LanguageSwitcher, like the apply / status / offer / data pages"
  );
});
