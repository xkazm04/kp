// inbound-setup-honesty — SOURCE GUARDS over the two channel-receiver contracts that
// were silently broken (repo pattern, cf. channels-tenancy.test.ts). Both live at a
// route/UI seam that the NextRequest-based route tests cannot exercise in this
// environment, so they are pinned structurally.
//
//   (1) LIVENESS: received_count is documented in db/channels.ts as stamped for ANY
//       authenticated POST — the Channels "Received" column and the row's Listening
//       badge are built on it. The receiver actually stamped it only after a TERMINAL
//       intake outcome, so 400/410/413/422/429 and duplicate_ignored all returned
//       unstamped: a mis-mapped integration failing on every lead was indistinguishable
//       from a receiver nobody ever connected. The stamp must now happen exactly once,
//       immediately after the token resolves, and NOT before authentication (an unknown
//       token or a rate-limited flood attributes to nobody).
//
//   (2) AUTO-SELECT: POST /api/channels/webhooks answers `{ webhook }`, but the Add
//       modal read `p.token` — always undefined, so onCreated("") fired and adding a
//       second receiver left the setup guide and CV sim on the OLD one (the wrong
//       endpoint shown for the just-created role). The producer side is `satisfies`-
//       pinned for tsc; this guards the consumer read and the envelope key together.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(dir, ...p), "utf8");

const receiverSrc = read("inbound", "[token]", "route.ts");
const webhooksSrc = read("webhooks", "route.ts");
const modalSrc = read("..", "..", "features", "hiring", "channels", "ChannelsAddReceiverModal.tsx");
const channelsDbSrc = read("..", "..", "_lib", "db", "channels.ts");
// L0 (docs/concepts/local-first-edge.md) moved the JSON-lead half of the receiver
// into a shared core, so the clock's pull + drain doors reach the SAME contract
// instead of a second copy of it. The guards below therefore read the receiver and
// the core as ONE surface: `where()` finds a marker in whichever file owns it now,
// and both files are still required to exist. A marker that vanished from both
// still fails — which is the property these tests were written to hold.
const coreSrc = read("..", "..", "_lib", "inbound-lead.ts");
const surface = `${receiverSrc}
${coreSrc}`;

test("the liveness receipt is stamped exactly once, right after the token authenticates", () => {
  const stamps = [...receiverSrc.matchAll(/recordChannelWebhookReceipt\(token\)/g)];
  assert.equal(stamps.length, 1, "ONE contract means ONE call site — not one per terminal outcome");

  const stampAt = stamps[0].index!;
  const authAt = receiverSrc.indexOf("getActiveChannelWebhook(token)");
  const rateLimitAt = receiverSrc.indexOf("rateLimit(");
  assert.ok(authAt >= 0 && rateLimitAt >= 0, "guard the guard: the auth + rate-limit steps are still recognizable");

  assert.ok(rateLimitAt < stampAt, "a flood shed before the token is read must stamp nothing");
  assert.ok(authAt < stampAt, "the receipt is attributed to an AUTHENTICATED caller");

  // It must precede every payload branch IN THE ROUTE, so a rejected body still
  // proves liveness. The branches that moved into the core are ordered by call:
  // the route stamps before it ever calls ingestInboundLeadJson, so every outcome
  // the core can return is necessarily downstream of the stamp.
  for (const marker of ['contentType.includes("multipart/form-data")', '"Payload too large."', "ingestInboundLeadJson("]) {
    const at = receiverSrc.indexOf(marker);
    assert.ok(at >= 0, `guard the guard: "${marker}" still exists in the receiver`);
    assert.ok(stampAt < at, `the receipt must be stamped before the "${marker}" branch can return unstamped`);
  }
  for (const marker of ["missing_email", "intakeLead(", "duplicate_ignored"]) {
    assert.ok(surface.includes(marker), `guard the guard: "${marker}" still exists on the receiver surface`);
  }
});

test("the clock doors reach the receiver contract through the SAME core, not a copy", () => {
  // The whole point of the extraction: three arrival paths, one implementation. If a
  // future change re-inlines the intake into the route (or into a puller), the KO
  // semantics, the idempotency window and the accepted/receipt stamps drift apart
  // silently — exactly the class of bug the liveness guard above exists to catch.
  assert.match(receiverSrc, /ingestInboundLeadJson\(/, "the route delegates the JSON branch to the core");
  assert.doesNotMatch(receiverSrc, /intakeLead\(/, "the route must not file leads itself any more");
  assert.match(coreSrc, /export async function ingestInboundLeadByToken/, "the token-authenticating door the clock uses");
  // The core's own door must stamp liveness for a pulled/drained delivery too.
  assert.match(coreSrc, /recordChannelWebhookReceipt\(input\.token\)/, "a pulled delivery proves liveness like a pushed one");
});

test("the ACCEPTED lead counter stays separate and stays gated on a real new candidate", () => {
  const accepted = [...surface.matchAll(/recordChannelWebhookAccepted\((token|webhook\.token)\)/g)];
  assert.equal(accepted.length, 2, "one per intake branch (CV upload in the route, JSON lead in the core)");
  assert.match(receiverSrc, /if \(outcome\.created\) recordChannelWebhookAccepted/, "CV branch: only a new candidate");
  assert.match(coreSrc, /if \(!outcome\.duplicate\) recordChannelWebhookAccepted/, "JSON branch: never a duplicate");
});

test("the documented liveness contract names the authenticated-POST boundary", () => {
  const doc = channelsDbSrc.slice(channelsDbSrc.indexOf("/** Stamp one RECEIVED payload"));
  assert.match(doc, /AUTHENTICATED POST/, "the doc states the boundary the receiver implements");
  assert.match(doc, /unknown or revoked token/i, "the doc states what is NOT stamped");
  assert.doesNotMatch(
    doc.slice(0, doc.indexOf("export function recordChannelWebhookReceipt")),
    /stamped for ANY POST\b/,
    "the pre-fix wording (which the receiver never implemented) must not survive"
  );
});

// (3) OWNERSHIP: creation resolves the target job with getJob — an UNSCOPED by-id point
//     read (exempt in jobs-tenancy.test.ts because a point read can't ENUMERATE another
//     tenant). That exemption is paid for by the ROUTE checking visibility, exactly as
//     GET /api/jobs/[id] does: without it a session could bind a receiver to another
//     team's authored role by id, and the receivers list (WEBHOOK_SELECT LEFT JOINs
//     `jobs` with no tenant filter) would render that team's confidential role title.
test("receiver creation gates the unscoped getJob read on job visibility", () => {
  assert.match(webhooksSrc, /jobVisibleToWorkspace/, "the create path must check the caller can see the job");
  const gateAt = webhooksSrc.indexOf("jobVisibleToWorkspace(jobId, ws)");
  const createAt = webhooksSrc.indexOf("createChannelWebhook(");
  assert.ok(gateAt >= 0, "the gate reads the caller's workspace");
  assert.ok(createAt >= 0, "guard the guard: creation still happens here");
  assert.ok(gateAt < createAt, "the gate must precede the write");
  assert.match(webhooksSrc, /if \(!job \|\| !jobVisibleToWorkspace\(jobId, ws\)\)[\s\S]{0,120}?status: 404/, "404, not 403 — same answer as an unknown id");
});

test("receiver creation returns the `{ webhook }` envelope and the modal reads its token", () => {
  assert.match(webhooksSrc, /satisfies \{ webhook: ChannelWebhookRecord \}/, "the response shape is tsc-pinned");
  assert.match(modalSrc, /webhook\?: ChannelWebhookRecord/, "the modal types the response it parses");
  assert.match(modalSrc, /onCreated\(p\.webhook\?\.token \?\? ""\)/, "auto-select reads the token off the envelope");
  assert.doesNotMatch(modalSrc, /onCreated\(typeof p\.token/, "the dead top-level `token` read must not come back");
});
