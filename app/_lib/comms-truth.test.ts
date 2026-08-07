import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deliveryClaim, isRelayConfigured } from "./comms-truth.ts";
import { OUTBOX_STATUSES } from "./comms-status.ts";
import { COMM_SENT_KINDS } from "./decision-attribution.ts";

// REC-10 — the honesty-vocabulary selector. `queued` is a TERMINAL non-delivery
// state (comms-status.ts), so the claim a surface renders must never upgrade it
// to "sent" — and a real per-message status must always beat the blind
// capability fallback.

test("deliveryClaim: the row's real status wins over capability", () => {
  for (const relay of [true, false]) {
    assert.equal(deliveryClaim(relay, "sent"), "sent");
    assert.equal(deliveryClaim(relay, "queued"), "queued", "a queued row is never claimed as sent");
    assert.equal(deliveryClaim(relay, "failed"), "failed");
    assert.equal(deliveryClaim(relay, "bounced"), "failed", "a bounce receipt is a failure, not a green sent");
  }
});

test("deliveryClaim: with no per-message status, capability decides", () => {
  assert.equal(deliveryClaim(true), "sent");
  assert.equal(deliveryClaim(false), "queued");
  assert.equal(deliveryClaim(true, null), "sent");
  assert.equal(deliveryClaim(false, null), "queued");
});

test("deliveryClaim covers every canonical outbox status", () => {
  for (const status of OUTBOX_STATUSES) {
    const claim = deliveryClaim(false, status);
    assert.ok(["sent", "queued", "failed"].includes(claim), `status ${status} maps to a claim`);
  }
});

test("isRelayConfigured mirrors COMMS_WEBHOOK_URL", () => {
  const prev = process.env.COMMS_WEBHOOK_URL;
  try {
    delete process.env.COMMS_WEBHOOK_URL;
    assert.equal(isRelayConfigured(), false);
    process.env.COMMS_WEBHOOK_URL = "https://relay.example/hook";
    assert.equal(isRelayConfigured(), true);
  } finally {
    if (prev === undefined) delete process.env.COMMS_WEBHOOK_URL;
    else process.env.COMMS_WEBHOOK_URL = prev;
  }
});

// ---- Catalog contract: the queued vocabulary exists and never says "sent" ----
//
// kindLabel (decision-attribution.ts) renders `kindsQueued.<kind>` for every
// dispatched-comm kind when no relay is configured. Lock BOTH locales: each of
// the COMM_SENT_KINDS must carry a queued variant, and that variant must not
// smuggle the very delivery claim it exists to correct.

type Catalog = { analytics: { log: { kinds: Record<string, string>; kindsQueued: Record<string, string> } } };

function loadCatalog(locale: "en" | "cs"): Catalog {
  return JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8")) as Catalog;
}

// "sent/emailed" in en; "odesláno/odeslána/odeslán/posláno" in cs. (The word
// "Outbox" itself is fine — it names the local audit log, not a delivery.)
const SENT_CLAIM = /\bsent\b|\bemailed\b|odesl[áa]n|posl[áa]n/i;

for (const locale of ["en", "cs"] as const) {
  test(`analytics.log kindsQueued (${locale}): every dispatched-comm kind has an honest queued label`, () => {
    const { kinds, kindsQueued } = loadCatalog(locale).analytics.log;
    for (const kind of COMM_SENT_KINDS) {
      assert.ok(kinds[kind], `${locale} kinds.${kind} exists`);
      const queued = kindsQueued[kind];
      assert.ok(queued, `${locale} kindsQueued.${kind} exists`);
      assert.ok(!SENT_CLAIM.test(queued), `${locale} kindsQueued.${kind} must not claim delivery: "${queued}"`);
    }
  });
}
