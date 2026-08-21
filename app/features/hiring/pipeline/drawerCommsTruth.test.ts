// drawer-comms-truth — the candidate drawer and the Comms Center must tell the SAME
// delivery truth about the SAME message.
//
// The bug this pins: `deliverable` ("could a real relay address this recipient at
// all?") was projected onto the drawer bundle (candidate-timeline.ts) and then DROPPED
// at its only read site (PipelineCommsList), so an unaddressable message read as a
// neutral "queued" in the drawer while Channels correctly warned. That is the exact
// cross-surface divergence commsVerdict was written to kill — regrown on a neighbouring
// field. The structural fix is ONE shared predicate; these tests pin both the rule and
// the fact that neither surface re-derives it locally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync as read } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnaddressable } from "@/app/_lib/comms-view";

// Resolve off this file, not the cwd — the runner's working directory is not a contract.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const readFileSync = (rel: string, enc: "utf8") => read(resolve(ROOT, rel), enc);

const CHANNELS_ROWS = "app/features/hiring/channels/ChannelsCommsRows.tsx";
const DRAWER_LIST = "app/features/hiring/pipeline/PipelineCommsList.tsx";
const TOKEN_LINK = "app/features/hiring/pipeline/PipelineTokenLink.tsx";

// --- the rule ---------------------------------------------------------------------

test("a relay-addressable recipient never warns, whatever the relay capability", () => {
  for (const relay of [true, false, null, undefined]) {
    assert.equal(isUnaddressable({ deliverable: true }, relay), false);
  }
});

test("with a relay configured, an undeliverable recipient warns", () => {
  assert.equal(isUnaddressable({ deliverable: false }, true), true);
});

test("NO relay configured is a different (and honest) situation — it never warns", () => {
  // With no relay every message is a terminal local-outbox row for everyone, so a
  // missing address is not THIS message's problem. Warning here would be a second,
  // wrong claim — and the Comms Center has never made it.
  assert.equal(isUnaddressable({ deliverable: false }, false), false);
});

test("an unresolved capability bit stays silent rather than guessing", () => {
  // useDeliveryCapability returns null until /api/comms/capability answers.
  assert.equal(isUnaddressable({ deliverable: false }, null), false);
});

test("an unmatched relay receipt is exempt (it has no candidate address by construction)", () => {
  assert.equal(isUnaddressable({ deliverable: false, orphaned: true }, true), false);
});

test("a row with no deliverable bit at all (legacy / unprojected) stays silent", () => {
  assert.equal(isUnaddressable({}, true), false);
});

// --- OVER-CORRECTION GUARD --------------------------------------------------------
//
// The failure mode opposite to the bug: making every merely-queued message start
// warning. A genuinely queued message WITH a real address must stay neutral — the
// warning is about addressability, never about the delivery verdict.
test("a genuinely queued message with a real address does NOT warn", () => {
  const queuedButAddressable = { deliverable: true, orphaned: false };
  assert.equal(isUnaddressable(queuedButAddressable, true), false);
});

// --- one predicate, two surfaces --------------------------------------------------

test("BOTH surfaces route through the shared predicate and neither re-derives it", () => {
  for (const file of [CHANNELS_ROWS, DRAWER_LIST]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /isUnaddressable\(/, `${file} must ask the shared predicate`);
    // A local `deliverable === false` is exactly how the divergence grew the first
    // time: one surface acting on the bit, the other silently ignoring it.
    assert.doesNotMatch(
      src,
      /deliverable\s*===/,
      `${file} re-derives the unaddressable rule locally — use isUnaddressable instead`
    );
  }
});

test("the drawer reuses the Comms Center's WORDING, not a second vocabulary", () => {
  const src = readFileSync(DRAWER_LIST, "utf8");
  assert.match(src, /noAddressHint/, "the drawer must render channels.comms.noAddressHint");
  const channels = readFileSync(CHANNELS_ROWS, "utf8");
  assert.match(channels, /noAddressHint/);
});

// --- the drawer no longer drops payload it is handed -------------------------------
//
// `channel`, `recoveredAt` and `bouncedAt` rode the bundle unread alongside
// `deliverable`. Silent dead payload is how the next divergence starts, so each is now
// rendered; this pins that they are read at all.
test("the drawer reads the rest of the bundle's delivery payload", () => {
  const src = readFileSync(DRAWER_LIST, "utf8");
  for (const field of ["m.channel", "m.recoveredAt", "m.bouncedAt"]) {
    assert.match(src, new RegExp(field.replace(".", "\\.")), `${field} is projected but unread`);
  }
});

// --- the manual delivery path must not lie either ----------------------------------
//
// When no relay is configured the copy panel IS the delivery path — the drawer's own
// "queued, not delivered" copy points the recruiter at it. So the ✓ on that button is a
// claim in the same family as "sent": it says this candidate's link is on your clipboard.
// `navigator.clipboard` is undefined in a NON-SECURE context (a self-hosted install on
// plain http://, the deployment shape this product supports), and the panel used to
// optional-chain the write away and flip to ✓ regardless — so the recruiter pasted
// whatever was on the clipboard before into the candidate's email. copyText
// (export-utils) resolves false in exactly that case; the saved-view share link has
// always used it.
test("the ✓ on a token-link copy waits for the clipboard write to actually succeed", () => {
  const src = readFileSync(TOKEN_LINK, "utf8");
  assert.match(src, /copyText\(/, "the copy must go through the shared guarded helper");
  assert.doesNotMatch(
    src,
    /clipboard\?\.\s*writeText/,
    "an optional-chained clipboard write swallows an absent clipboard and still claims success"
  );
});

// --- the GDPR panel must never imply "still working" after giving up ---------------

test("a failed bundle load puts the consent panel into its real failed state", () => {
  const hook = readFileSync("app/features/hiring/pipeline/usePipelineCandidateDrawerState.ts", "utf8");
  const panel = readFileSync("app/features/hiring/pipeline/PipelineConsentPanel.tsx", "utf8");
  const drawer = readFileSync("app/features/hiring/pipeline/PipelineCandidateDrawer.tsx", "utf8");
  // The catch that used to reset ONLY history now also records the give-up.
  assert.match(hook, /setBundleFailed\(true\)/);
  assert.match(hook, /bundleFailed/);
  // …the drawer hands it to the panel…
  assert.match(drawer, /loadFailed=\{bundleFailed\}/);
  // …and the panel's failed branch honours it, ahead of the loading branch.
  assert.match(panel, /failed \|\| loadFailed \?/);
  // And the one-call bundle stays one call: the panel must not gain a second fetch.
  assert.equal((panel.match(/fetch\(/g) ?? []).length, 1, "ConsentPanel must keep exactly its standalone fallback fetch");
});
