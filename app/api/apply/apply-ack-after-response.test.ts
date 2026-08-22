// The acknowledgement email was serialized in FRONT of the apply response: the
// entry was already filed and the dispatch's failure already couldn't change the
// outcome, yet the applicant waited on an SMTP/relay round-trip before their
// form said anything — so a slow provider looked like a slow (or broken) apply
// form for a submission that had fully succeeded.
//
// The dispatches now run after the response via next/server's `after` (stable
// since 15.1, sanctioned for Route Handlers — see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md).
// What must NOT change is any dispatch SEMANTIC: all three sites still send, the
// "newly reachable" re-ack included, failures are still logged, and the status
// token is still minted synchronously so the response and the email share one.
//
// Source-contract test — importing the routes would pull in `next/server`, which
// the unit runner can't resolve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const conversational = read("[id]/route.ts");
const quick = read("[id]/quick/route.ts");
const leadIntake = read("../../_lib/lead-intake.ts");
const helper = read("../../_lib/after-response.ts");

test("the post-response hook is next/server's `after`, and scheduling can't break the response", () => {
  assert.match(helper, /import \{ after \} from "next\/server"/, "the sanctioned Route Handler API, not a bare detached promise");
  assert.match(helper, /try \{\s*after\(run\);\s*\} catch \{\s*void run\(\);\s*\}/, "no request context (script/test) must fall back, never throw");
  assert.match(helper, /catch \(err\) \{\s*console\.error\(`\[after:\$\{label\}\]`/, "a deferred failure is logged, never an unhandled rejection");
});

test("both conversational ack sites are deferred — including the newly-reachable re-ack", () => {
  assert.match(conversational, /afterResponse\("apply-ack"/, "the first-apply acknowledgement");
  assert.match(conversational, /afterResponse\("apply-reack"/, "the re-apply 'newly reachable' acknowledgement (its own dispatch semantic)");
  // Both still DISPATCH — deferral must not have become a drop.
  assert.equal(
    (conversational.match(/dispatchApplicationReceived\(/g) ?? []).length,
    2,
    "exactly the two historical dispatches remain"
  );
  // …and every one of them sits INSIDE a deferral, not in front of the response.
  for (let at = conversational.indexOf("dispatchApplicationReceived("); at > 0; at = conversational.indexOf("dispatchApplicationReceived(", at + 1)) {
    const scheduled = conversational.lastIndexOf("afterResponse(", at);
    assert.ok(scheduled > 0 && at - scheduled < 300, "a dispatch is back on the response path (no enclosing afterResponse)");
  }
});

test("the status token is still minted BEFORE the deferred dispatch", () => {
  // The email and the JSON response must carry the SAME token; minting inside the
  // deferred callback would hand the applicant a different one (or none).
  const mintAt = conversational.indexOf("const statusToken = safeStatusLink(entry.id)");
  const deferAt = conversational.indexOf('afterResponse("apply-ack"');
  assert.ok(mintAt > 0 && deferAt > mintAt, "safeStatusLink runs synchronously, before the ack is scheduled");
});

test("the newly-reachable re-ack carries the status link, minted before the deferral", () => {
  // This ack is the ONLY one a candidate whose entry had no address until now ever
  // receives, and since a name/email-matched repeat no longer gets the token in its
  // JSON response (the capability gate in acknowledgeReapply), the email is the
  // whole delivery path for their status link. Shipping it bare left exactly one
  // class of applicant with no durable way to check where they stand.
  assert.match(
    conversational,
    /dispatchApplicationReceived\(merged, reackLink \? \{ statusLink: reackLink \} : undefined\)/,
    "the re-ack must carry the status link, like the first-apply and quick-apply acks"
  );
  const mintAt = conversational.indexOf("const reackToken = safeStatusLink(merged.id)");
  const deferAt = conversational.indexOf('afterResponse("apply-reack"');
  assert.ok(mintAt > 0 && deferAt > mintAt, "the token is minted synchronously, before the ack is scheduled");
  // The link is read OUTSIDE the app, in the language the EMAIL renders in — the
  // entry's own locale — not the language of whoever POSTed the repeat.
  assert.match(
    conversational,
    /\/status\/\$\{reackToken\}\?lang=\$\{merged\.locale \|\| applicantLocale\}/,
    "the re-ack status link is pinned to the locale the email itself renders in"
  );
});

test("the lead intake defers through the caller's scheduler, and keeps its inline default", () => {
  assert.match(quick, /defer: \(task\) => afterResponse\("quick-apply-ack", task\)/, "the quick-apply route opts in");
  assert.match(leadIntake, /defer\?: \(task: \(\) => Promise<void>\) => void/, "the scheduler is injected, so the lib stays request-context-free");
  assert.match(
    leadIntake,
    /if \(input\.defer\) input\.defer\(\(\) => ack\(entry, enrichLink\)\);\s*else await ack\(entry, enrichLink\)/,
    "omitted = the historical inline await, so a caller that hasn't opted in is byte-identical"
  );
  // One seam, both sites — the first-time ack and the newly-reachable re-ack.
  assert.equal((leadIntake.match(/await sendAck\(/g) ?? []).length, 2, "BOTH ack sites go through the one seam");
  assert.equal((leadIntake.match(/await ack\(/g) ?? []).length, 1, "…and the raw ack is awaited only inside that seam's inline branch");
  assert.match(leadIntake, /statusLink \? \{ statusLink \} : undefined/, "the ack still carries the status link (capst-l1-002)");
});
