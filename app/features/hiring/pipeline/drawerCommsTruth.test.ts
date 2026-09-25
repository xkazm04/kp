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
import { existsSync, readFileSync as read } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnaddressable } from "@/app/_lib/comms-view";

// Resolve off this file, not the cwd — the runner's working directory is not a contract.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const readFileSync = (rel: string, enc: "utf8") => read(resolve(ROOT, rel), enc);

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

// The Comms Center's half left with the "Intake Studio" ledger (kit-unification, Gate K2): the
// kit ledger (channels/kit/ChannelsKitComms.tsx) renders no unaddressable warning yet, and its
// message pane shows the raw `deliverable` bit. Until it does, only the drawer is pinned here.
test("the drawer routes through the shared predicate and does not re-derive it", () => {
  for (const file of [DRAWER_LIST]) {
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
  const hook = readFileSync("app/features/hiring/pipeline/candidate/state/useCandidateBundle.ts", "utf8");
  const panel = readFileSync("app/features/hiring/pipeline/PipelineConsentPanel.tsx", "utf8");
  const record = readFileSync("app/features/hiring/pipeline/candidate/CandidateRecordTab.tsx", "utf8");
  // The give-up is the reducer's (candidateBundle.ts): a failed pull dispatches `fail`,
  // and only a FIRST-load failure (no snapshot at all) reads as the panel's failure.
  assert.match(hook, /dispatch\(\{ type: "fail", seq \}\)/);
  assert.match(hook, /bundleFailed: consentFailed\(state\)/);
  // …never the old wipe, which blanked a good history AND a good GDPR snapshot on a
  // transient re-pull failure.
  assert.doesNotMatch(hook, /setHistory\(\[\]\)/);
  assert.doesNotMatch(hook, /setBundleFailed\(true\)/);
  // …the candidate modal's Record tab hands it to the panel, with the bundle's retry…
  assert.match(record, /loadFailed=\{bundleFailed\}/);
  assert.match(record, /onRetry=\{st\.retry\}/);
  // …and the panel's failed branch honours it, ahead of the loading branch.
  assert.match(panel, /failed \|\| loadFailed \?/);
  // And the one-call bundle stays one call: the panel must not gain a second fetch.
  assert.equal((panel.match(/fetch\(/g) ?? []).length, 1, "ConsentPanel must keep exactly its standalone fallback fetch");
});

test("the consent panel's give-up has a way out that re-fires the load that failed", () => {
  const panel = readFileSync("app/features/hiring/pipeline/PipelineConsentPanel.tsx", "utf8");
  assert.match(panel, /tCommon\("retry"\)/, "a give-up with no way out is a dead end");
  // In the modal the bundle owns the load, so the Retry re-pulls the bundle…
  assert.match(panel, /if \(onRetry\) \{\s*onRetry\(\);/);
  // …standalone, it re-fires the panel's own (single) read.
  assert.match(panel, /setReloadTick\(\(n\) => n \+ 1\)/);
  assert.match(panel, /\[entryId, bundled, reloadTick\]/, "…and the effect depends on it, or the button does nothing");
});

test("an in-modal resend re-pulls the candidate's story", () => {
  const activity = readFileSync("app/features/hiring/pipeline/candidate/CandidateActivityTab.tsx", "utf8");
  assert.match(activity, /<PipelineCommsList[^>]*onResent=\{st\.onLetterResent\}/);
});

// --- the quality-of-hire card must not VANISH on a failed read ---------------------
//
// drawer-cards-hold-the-chip-law. The card's own small read swallowed every failure
// with `.catch(() => undefined)`, and one screen down `if (!view) return null` turned
// that into a card that was simply NOT THERE for a real hire — no message, nothing to
// press, and the recruiter cannot tell "this hire has no rating question" from "the
// read failed". That is precisely the hole ConsentPanel's `loadFailed` closed one card
// over, so it is pinned the same way, from the same file.

const HIRE_CARD = "app/features/hiring/pipeline/PipelineHireOutcomeCard.tsx";

test("a failed quality-of-hire read is stated, not swallowed", () => {
  const src = readFileSync(HIRE_CARD, "utf8");
  assert.doesNotMatch(
    src,
    /\.catch\(\(\)\s*=>\s*undefined\)/,
    "the read's catch must record the give-up, not discard it"
  );
  assert.match(src, /setLoadFailed\(true\)/, "the catch records the failure");
  assert.match(src, /if \(loadFailed\)/, "…and the render answers it BEFORE the !view early return");
  assert.match(src, /t\("loadFailed"\)/, "…with a localized line, not a silent frame");
});

test("the failed state offers a retry that actually re-fires the read", () => {
  const src = readFileSync(HIRE_CARD, "utf8");
  assert.match(src, /t\("retry"\)/, "a give-up with no way out is still a dead end");
  assert.match(src, /setReloadTick\(\(n\) => n \+ 1\)/, "the retry bumps the effect's key…");
  assert.match(src, /\[entryId, reloadTick\]/, "…and the effect depends on it, or the button does nothing");
});

test("the rating callback declares the bindings it closes over", () => {
  // A deps array of just [entryId] pins the FIRST render's `errorMessage` and `t`,
  // so a reader who switches language keeps getting the previous language's refusal.
  const src = readFileSync(HIRE_CARD, "utf8");
  assert.match(src, /\[entryId, errorMessage, t\]/);
});

// --- one verdict vocabulary, no private colour maps -------------------------------
//
// The drawer rendered the stage through the shared StatusChip and, twenty pixels
// below, hand-rolled the interview verdict from a REC_STYLE map that existed in FOUR
// files. A verdict is a judgement, not a status (StatusChip's own doctrine), so the
// cards render it through Badge's one shared verdict treatment, red for reject.

test("no drawer card re-derives a verdict palette of its own", () => {
  for (const rel of [
    "app/features/hiring/pipeline/PipelineInterviewOutcomeCard.tsx",
    "app/features/hiring/pipeline/PipelineHumanScorecardCard.tsx",
  ]) {
    const src = readFileSync(rel, "utf8");
    assert.doesNotMatch(src, /REC_STYLE/, `${rel} must not hold a local verdict colour map`);
    assert.match(src, /interviewRecommendationToken\(/, `${rel} must render the verdict through Badge's shared treatment`);
    assert.doesNotMatch(src, /recommendationTone\(/, `${rel} must not tone a verdict as a lifecycle status`);
  }
});

test("the two non-chip verdict surfaces share ONE class table", () => {
  for (const rel of [
    "app/features/hiring/schedule/ScheduleHumanScorecardForm.tsx",
    "app/features/library/jobs/jobsCompareInterviewsTypes.ts",
  ]) {
    const src = readFileSync(rel, "utf8");
    assert.match(src, /RECOMMENDATION_CHIP_CLASS/, `${rel} must take the shared table…`);
    assert.doesNotMatch(src, /advance: "bg-/, `…${rel} must not re-declare the colours`);
  }
});

// --- one recovery door, three surfaces (pipeline-candidate-drawer/B) ---------------
//
// A bounced or dead-lettered letter used to be painted red in the candidate modal with
// nothing to press, while the Comms Center and the dev-case outbox each chose the door
// with their OWN predicate (raw `bounced`/`status === "failed" && !recovered` in one,
// `verdict` in the other). resendDoorOf (comms-resend-outcome.ts) is now the one rule.

// The Comms Center's message document is the kit reading pane since the kit promotion (Gate K2).
const CHANNELS_MODAL = "app/features/hiring/channels/kit/ChannelsKitMessagePane.tsx";
const OUTBOX_ROWS = "app/features/tools/devcases/OutboxRows.tsx";

test("every surface that offers a resend asks resendDoorOf, and none re-derives the door", () => {
  for (const file of [CHANNELS_MODAL, OUTBOX_ROWS, DRAWER_LIST]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /resendDoorOf\(/, `${file} must ask the shared door predicate`);
    // The OLD door predicates, verbatim: raw status bits in the Comms Center modal,
    // a local verdict test in the outbox. (A failure-REASON line may still read the
    // verdict — it is the door that must not.)
    assert.doesNotMatch(src, /status === "failed" && !/, `${file} re-derives the retry door from raw status bits`);
    assert.doesNotMatch(src, /verdict === "failed" \? <ResendButton/, `${file} re-derives the retry door from the verdict`);
    assert.doesNotMatch(src, /(\.bounced|verdict === "bounced") \?\s*\(?\s*(<div[^>]*>\s*)?<BouncedResend/, `${file} re-derives the bounced door`);
    // Every door control is rendered under the shared door, and only there.
    const controls = (src.match(/<(ResendButton|BouncedResend)\b/g) ?? []).length;
    const gated = (
      src.match(/(door|resendDoorOf\([^)]*\)) === "(retry|correctAddress)" \?\s*\(?\s*(<div[^>]*>\s*)?<(ResendButton|BouncedResend)\b/g) ?? []
    ).length;
    assert.ok(controls > 0, `${file} must offer a door`);
    assert.equal(gated, controls, `${file}: every resend control must sit under resendDoorOf's answer`);
  }
});

test("the candidate modal renders the Comms Center's own door components, pre-filled with the address on file", () => {
  const src = readFileSync(DRAWER_LIST, "utf8");
  assert.match(src, /<ResendButton\b/);
  assert.match(src, /<BouncedResend\b/);
  assert.match(src, /defaultRecipient=\{m\.recipient\}/, "the bounced door must pre-fill like Channels does");
});

test("the Activity tab carries the needs-you count from the shared counter, gated on consent", () => {
  const body = readFileSync("app/features/hiring/pipeline/candidate/CandidateModalBody.tsx", "utf8");
  assert.match(body, /lettersNeedingYou\(/, "the count comes from the one predicate, not a local filter");
  const tabs = readFileSync("app/features/hiring/pipeline/candidate/CandidateModalTabs.tsx", "utf8");
  assert.match(tabs, /needsYou/, "the tab strip renders the count");
});

test("the resend door owns the channel literals; the dispatcher's local copies are pinned equal elsewhere", () => {
  // comms-dispatch.ts keeps its own copies (cbc5c0c1f: re-exporting them put one more
  // module on every route graph). app/_lib/comms-dispatch-channels.test.ts pins that the
  // two copies agree; here the door module must still declare them, so the client-side
  // rule never depends on the server dispatcher.
  const door = readFileSync("app/_lib/comms-resend-outcome.ts", "utf8");
  assert.match(door, /export const SIM_COMMS_CHANNEL = "simulation";/);
  assert.match(door, /export const REFUSED_COMMS_CHANNEL = "refused";/);
  assert.doesNotMatch(door, /from\s+["']\.\/comms-dispatch(\.ts)?["']/, "the door stays import-free of the dispatcher");
});

test("the drawer bundle carries each letter's recipient, so the bounced door can pre-fill it", async () => {
  // unit-db FIRST: candidate-timeline reaches the stores, which read KP_DB_PATH at load.
  const { cleanupUnitDb } = await import("@/app/_lib/testing/unit-db");
  const { toCandidateComm } = await import("@/app/_lib/candidate-timeline");
  try {
    const comm = toCandidateComm({
      id: "o1",
      recipient: "ada@example.com",
      subject: "Offer",
      body: "…",
      kind: "offer",
      channel: "email",
      status: "sent",
      ref: "e1",
      createdAt: "2026-09-01T00:00:00.000Z",
      failureDetail: null,
      deliverable: true,
      recovered: false,
      recoveredAt: null,
      bounced: true,
      bouncedAt: "2026-09-02T00:00:00.000Z",
      bounceDetail: "550",
      orphaned: false,
    });
    assert.equal((comm as { recipient?: unknown }).recipient, "ada@example.com");
  } finally {
    cleanupUnitDb();
  }
});

// --- the retired facet-row file is actually gone ----------------------------------

test("PipelineFacetRow is deleted, not kept as a load-bearing-sounding tombstone", () => {
  assert.equal(
    existsSync(resolve(ROOT, "app/features/hiring/pipeline/PipelineFacetRow.tsx")),
    false,
    "the chip-grid file had zero importers; a file with a confident header comment reads as live code"
  );
});
