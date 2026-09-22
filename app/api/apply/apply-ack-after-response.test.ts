// The acknowledgement email was serialized in FRONT of the apply response: the
// entry was already filed and the dispatch's failure already couldn't change the
// outcome, yet the applicant waited on an SMTP/relay round-trip before their
// form said anything — so a slow provider looked like a slow (or broken) apply
// form for a submission that had fully succeeded.
//
// The dispatches now run after the response via next/server's `after` (stable
// since 15.1, sanctioned for Route Handlers — see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md).
// What must NOT change is any dispatch SEMANTIC: every ack still sends, the
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
// Since the doors file through ONE core (application-filing.ts, challenge 2026-09-22
// candidate-apply-api/A), every acknowledgement — the first one and the
// newly-reachable re-ack, on the conversational, quick/lead and CV doors — is
// dispatched from that core's single ack seam. The rules below moved there with it;
// the routes keep only WHICH scheduler (and which label) they hand the core.
const core = read("../../_lib/application-filing.ts");
const sendAckFn = /const sendAck = async \([\s\S]*?\n  \};/.exec(core)?.[0] ?? "";

test("the post-response hook is next/server's `after`, and scheduling can't break the response", () => {
  assert.match(helper, /import \{ after \} from "next\/server"/, "the sanctioned Route Handler API, not a bare detached promise");
  assert.match(helper, /try \{\s*after\(run\);\s*\} catch \{\s*void run\(\);\s*\}/, "no request context (script/test) must fall back, never throw");
  assert.match(helper, /catch \(err\) \{\s*failureCount \+= 1;\s*console\.error\(`\[after:\$\{label\}\]`/, "a deferred failure is counted and logged, never an unhandled rejection");
});

test("the core's ack seam is the ONLY dispatch, and both of its sites (first ack, newly-reachable re-ack) go through it", () => {
  assert.ok(sendAckFn, "expected the core's sendAck seam");
  assert.equal((core.match(/dispatchApplicationReceived\(/g) ?? []).length, 1, "one dispatch, inside the seam's ack()");
  assert.match(sendAckFn, /if \(input\.defer\) input\.defer\(\(\) => ack\(entry, links\), kind\);\s*else await ack\(entry, links\);/, "deferred when the door gave a scheduler, the historical inline await otherwise");
  assert.equal((core.match(/await sendAck\(/g) ?? []).length, 2, "BOTH ack sites go through the one seam");
  assert.match(core, /await sendAck\(merged, "reack"\)/, "the newly-reachable re-ack still dispatches (deferral must not have become a drop)");
  assert.match(core, /await sendAck\(entry, "ack"\)/, "the first acknowledgement still dispatches");
  assert.equal((core.match(/await ack\(/g) ?? []).length, 1, "the raw ack is awaited only inside the seam's inline branch");
  // The old defect, forbidden: a door dispatching its own ack is how one ended up on
  // the response path in front of the applicant.
  for (const [name, src] of [["conversational", conversational], ["quick", quick], ["lead-intake", leadIntake]] as const) {
    assert.doesNotMatch(src, /dispatchApplicationReceived\(/, `${name} must acknowledge through the core's seam`);
  }
});

test("the conversational door defers BOTH ack kinds after the response, each under its own label", () => {
  assert.match(
    conversational,
    /defer: \(task, kind\) => afterResponse\(kind === "reack" \? "apply-reack" : "apply-ack", task\)/,
    "the first-apply ack and the re-apply 'newly reachable' ack (its own dispatch semantic) are both scheduled post-response"
  );
});

test("the status link is minted synchronously, BEFORE the ack is deferred, on every ack kind", () => {
  // The email and the JSON response must carry the SAME token; minting inside the
  // deferred callback would hand the applicant a different one (or none). This is the
  // ONE copy of that ordering now — the first-apply ack and the re-ack share it.
  const mintAt = sendAckFn.indexOf("input.statusLinkFor?.(entry)");
  const deferAt = sendAckFn.indexOf("input.defer(");
  assert.ok(mintAt > 0 && deferAt > mintAt, "statusLinkFor runs synchronously, before the ack is scheduled");
  assert.doesNotMatch(sendAckFn, /kind === "ack"[^;]*statusLinkFor|statusLinkFor[^;]*kind/, "the status link is not gated on the ack kind");
  // The conversational door mints through the core's best-effort helper…
  assert.match(conversational, /statusLinkFor: \(entry\) => \{\s*const token = safeStatusToken\(entry\.id\);/);
  // …and the response reads the SAME token back (getOrCreateStatusLink is per entry).
  assert.match(conversational, /const statusToken = safeStatusToken\(entry\.id\);/);
});

test("the newly-reachable re-ack carries the status link, pinned to the language the EMAIL renders in", () => {
  // This ack is the ONLY one a candidate whose entry had no address until now ever
  // receives, and since a name/email-matched repeat no longer gets the token in its
  // JSON response (the capability gate in acknowledgeReapply), the email is the
  // whole delivery path for their status link. Shipping it bare left exactly one
  // class of applicant with no durable way to check where they stand.
  assert.match(sendAckFn, /\.\.\.\(statusLink \? \{ statusLink \} : undefined\)/, "every ack the seam sends carries the status link when one was minted");
  // The link is read OUTSIDE the app, in the language the EMAIL renders in — the
  // entry's own locale — not the language of whoever POSTed the repeat.
  assert.match(
    conversational,
    /\/status\/\$\{token\}\?lang=\$\{entry\.locale \|\| applicantLocale\}/,
    "the status link is pinned to the locale the email itself renders in"
  );
});

test("the lead intake defers through the caller's scheduler, and keeps its inline default", () => {
  assert.match(quick, /defer: \(task\) => afterResponse\("quick-apply-ack", task\)/, "the quick-apply route opts in");
  assert.match(leadIntake, /defer\?: \(task: \(\) => Promise<void>\) => void/, "the scheduler is injected, so the lib stays request-context-free");
  assert.match(leadIntake, /defer: input\.defer,/, "…and handed to the core's seam untouched (omitted = the inline await above)");
  assert.match(core, /defer\?: \(task: \(\) => Promise<void>, kind: AckKind\) => void/, "the core's scheduler is optional too");
});
