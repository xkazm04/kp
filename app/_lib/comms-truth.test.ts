import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  deliveryClaim,
  emailInboundAddress,
  emailInboundDomain,
  isEmailInboundConfigured,
  isRelayConfigured,
} from "./comms-truth.ts";
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

// ---- INBOUND capability: no fabricated forwarding address ------------------
//
// inbound-setup-honesty. The Email intake wizard used to SYNTHESIZE a forwarding
// address from window.location (falling back to the literal `inbound.kp.app`)
// although no inbound-email provider exists in the repo, so every application
// forwarded there vanished. The address is now a capability read from
// EMAIL_INBOUND_DOMAIN — and when nothing is configured there is NO address, which
// is what forces the wizard to show the real HTTP receiver instead of a guess.

function withInboundDomain<T>(value: string | undefined, run: () => T): T {
  const prev = process.env.EMAIL_INBOUND_DOMAIN;
  try {
    if (value === undefined) delete process.env.EMAIL_INBOUND_DOMAIN;
    else process.env.EMAIL_INBOUND_DOMAIN = value;
    return run();
  } finally {
    if (prev === undefined) delete process.env.EMAIL_INBOUND_DOMAIN;
    else process.env.EMAIL_INBOUND_DOMAIN = prev;
  }
}

test("with no EMAIL_INBOUND_DOMAIN there is no inbound capability and NO address to show", () => {
  withInboundDomain(undefined, () => {
    assert.equal(emailInboundDomain(), null);
    assert.equal(isEmailInboundConfigured(), false);
    assert.equal(emailInboundAddress("hook_abc"), null, "an unconfigured deployment must fabricate nothing");
  });
  withInboundDomain("   ", () => {
    assert.equal(isEmailInboundConfigured(), false, "whitespace is not a configuration");
  });
});

test("a configured domain yields the token address, normalized and never guessed", () => {
  withInboundDomain("Inbound.Acme.CZ", () => {
    assert.equal(emailInboundDomain(), "inbound.acme.cz");
    assert.equal(isEmailInboundConfigured(), true);
    assert.equal(emailInboundAddress("hook_abc"), "hook_abc@inbound.acme.cz");
  });
  // Forgiving about how an operator pastes it — a URL, a whole address, a trailing path.
  for (const raw of ["https://inbound.acme.cz/", "anything@inbound.acme.cz", "inbound.acme.cz."]) {
    withInboundDomain(raw, () => assert.equal(emailInboundDomain(), "inbound.acme.cz", `normalizes ${raw}`));
  }
});

test("a value that isn't a domain is treated as unconfigured, not as an address host", () => {
  for (const raw of ["localhost", "not a domain", "inbound", "http://", "@"]) {
    withInboundDomain(raw, () => {
      assert.equal(emailInboundDomain(), null, `${raw} must not become a mail host`);
      assert.equal(emailInboundAddress("hook_abc"), null);
    });
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
