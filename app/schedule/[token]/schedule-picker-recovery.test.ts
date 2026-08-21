// Two ways the candidate self-scheduling surface could offer an instruction it then
// made impossible to follow. Both are CLIENT-side mirrors of the server rule they
// disagreed with, so both are pinned here:
//
//  1. SchedulePicker returned early on `s.error`. That state carries BOTH a fatal load
//     failure and a transient action failure, so a 409 ("that time was just taken —
//     please pick another") or an empty propose batch ("please add at least one time")
//     REPLACED the picker / propose form with the very instruction the candidate could
//     no longer act on. Nothing in the surface clears the error without an action, and
//     every action lives in the view that just vanished — reload-only recovery.
//
//  2. The post-reschedule refresh re-read `canReschedule` but not `rescheduleCapReached`.
//     Spending the LAST reschedule flips both in the same GET, so the booked card lost
//     the "different time" button and never gained the "propose your own times"
//     escalation the server (stuckCapped) would have accepted — the dead end the
//     escalation exists to remove.
//
// SOURCE-LEVEL, matching the sibling status-rate-limit / status-nps-tenancy tests:
// these are a React client component and a hook, there is no component renderer in the
// repo's unit runner, and the contract being pinned is "which state is rendered / which
// setter is called", which the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pickerSrc = readFileSync(path.join(HERE, "SchedulePicker.tsx"), "utf8");
const inviteSrc = readFileSync(path.join(HERE, "use-schedule-invite.ts"), "utf8");
const routeSrc = readFileSync(path.join(HERE, "..", "..", "api", "schedule", "[token]", "route.ts"), "utf8");

test("an ACTION error renders above the live state, never instead of it", () => {
  // The banner rides with both actionable states — the slot grid (where "pick another"
  // is followed) and the booked card (which hosts the RSVP / withdraw / propose actions).
  assert.match(pickerSrc, /\{errorBanner\}\s*<SlotPicker/, "the slot grid must survive an action error");
  assert.match(pickerSrc, /\{errorBanner\}\s*<BookedCard/, "the booked card must survive an action error");
  // …and no top-level guard may short-circuit the whole surface on `error` again.
  assert.doesNotMatch(
    pickerSrc,
    /if \(s\.error\)\s*\n\s*return \(/,
    "an error must not early-return over the state views"
  );
});

test("a LOAD failure still owns the surface — there is no invite to render behind it", () => {
  // The load effect sets `error` and returns without ever setting `invite`, so the
  // unloaded branch is where a fatal failure lands; it must show the error, not the
  // spinner copy (which would claim the page is still coming).
  const unloaded = pickerSrc.slice(pickerSrc.indexOf("if (!s.invite)"), pickerSrc.indexOf("const errorBanner"));
  assert.ok(unloaded.length > 0, "the unloaded guard must precede the banner");
  assert.match(unloaded, /s\.error \?/, "a load failure shows the error, not the loading copy");
  assert.match(unloaded, /tCommon\("loading"\)/, "…and a clean, still-loading invite shows the loading copy");
});

test("the post-reschedule refresh re-reads the cap flag, not just the allowance", () => {
  const refresh = inviteSrc.slice(
    inviteSrc.indexOf("if (isReschedule) {"),
    inviteSrc.indexOf("const rsvp = async (action:")
  );
  assert.ok(refresh.length > 0, "precondition: the reschedule branch is where the refresh lives");
  for (const setter of ["setCanReschedule(", "setCapReached(", "setSlots(", "setCalendarChecked("]) {
    assert.ok(refresh.includes(setter), `the reschedule refresh must re-read ${setter}`);
  }
  assert.match(
    refresh,
    /setCapReached\(Boolean\(nd\.rescheduleCapReached\)\)/,
    "…from the server's own flag, the same one the initial load reads"
  );
});

test("client and server name the cap flag identically — a rename can't silently read undefined", () => {
  assert.match(routeSrc, /rescheduleCapReached = invite\.status === "confirmed" && invite\.rescheduleCount >= MAX_RESCHEDULES/);
  assert.match(routeSrc, /\n\s*rescheduleCapReached,/, "the GET must actually put it on the wire");
  // Both client reads (initial load + post-reschedule refresh) use that exact key.
  // CODE only — the comments legitimately name the flag while explaining the bug.
  const inviteCode = inviteSrc.replace(/\/\/[^\n]*/g, "");
  assert.equal((inviteCode.match(/\bn?d\.rescheduleCapReached\b/g) ?? []).length, 2, "initial load AND reschedule refresh");
});
