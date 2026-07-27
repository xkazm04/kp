// Pins the inbound-webhook lead mapping (Erika gap E3): which payload shapes
// flatten, which keys resolve name/email (with diacritic folding), the
// fail-closed address selection (see pickEmail), and the provided-only KO verdict
// (explicit negative = fail; absent or uninterpretable = ungated, never a silent
// discard). This is the trust boundary for every third-party lead source.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLead, flattenLeadFields } from "./lead-payload.ts";

const KO = ["ko_auth", "ko_mode", "ko_lang"];

// ---------------------------------------------------------------------------
// flattenLeadFields — payload shapes
// ---------------------------------------------------------------------------

test("flattens top-level primitives with normalized keys", () => {
  assert.deepEqual(flattenLeadFields({ "E-mail address": "j@x.cz", Age: 33, ok: true }), {
    e_mail_address: "j@x.cz",
    age: "33",
    ok: "true",
  });
});

test("flattens a `fields` wrapper object", () => {
  assert.deepEqual(flattenLeadFields({ fields: { name: "Jana" } }), { name: "Jana" });
});

test("flattens Meta-style field_data, which overrides top-level keys", () => {
  const out = flattenLeadFields({
    name: "from-top-level",
    field_data: [
      { name: "full_name", values: ["Jana Nová"] },
      { name: "name", values: ["from-field-data"] },
    ],
  });
  assert.equal(out.full_name, "Jana Nová");
  assert.equal(out.name, "from-field-data");
});

test("ignores non-object payloads and non-primitive values", () => {
  assert.deepEqual(flattenLeadFields(null), {});
  assert.deepEqual(flattenLeadFields([1, 2]), {});
  assert.deepEqual(flattenLeadFields("nope"), {});
  assert.deepEqual(flattenLeadFields({ nested: { deep: "x" } }), {});
});

// ---------------------------------------------------------------------------
// extractLead — name & email mapping
// ---------------------------------------------------------------------------

test("maps a plain JSON form", () => {
  const lead = extractLead({ name: "Jana Nová", email: "jana@example.cz" }, KO);
  assert.equal(lead.name, "Jana Nová");
  assert.equal(lead.email, "jana@example.cz");
});

test("maps Czech keys through diacritic folding", () => {
  const lead = extractLead({ "Jméno": "Petr Dvořák", "E-mailová adresa": "petr@example.cz" }, []);
  assert.equal(lead.name, "Petr Dvořák");
  assert.equal(lead.email, "petr@example.cz");
});

test("composes first + last name when no full-name field exists", () => {
  const lead = extractLead(
    { field_data: [{ name: "first_name", values: ["Jana"] }, { name: "last_name", values: ["Nová"] }, { name: "email", values: ["j@x.cz"] }] },
    []
  );
  assert.equal(lead.name, "Jana Nová");
});

test("a malformed value in an email-named field is not an address", () => {
  const lead = extractLead({ email: "not-an-email" }, []);
  assert.equal(lead.email, "");
});

// ---------------------------------------------------------------------------
// extractLead — the address IS the identity, so selection fails closed
//
// The email becomes the dedupe key AND the recipient of the enrichment lead
// token + status link. An address belonging to someone else therefore hands one
// person's application to another — the two guards below are what stop that.
// ---------------------------------------------------------------------------

test("an email-shaped value under a non-address key is NOT the candidate", () => {
  // The old last-resort scan read every value, so this adopted the referrer.
  const lead = extractLead({ name: "Jana", referred_by: "kamarad@example.cz", note: "found via a friend" }, []);
  assert.equal(lead.email, "", "only a key that NAMES an address may supply the candidate's identity");
});

test("two distinct addresses in one payload ⇒ ungiven, never a guess", () => {
  const lead = extractLead({ name: "Jana", email: "jana@example.cz", recruiter_email: "recruiter@agency.cz" }, []);
  assert.equal(
    lead.email,
    "",
    "field naming across integrations can't rank addresses — refuse (the caller answers 422) rather than mail a stranger the candidate's links"
  );
  assert.equal(lead.name, "Jana", "the rest of the mapping still resolves — only the address is withheld");
});

test("the SAME address repeated across aliases is one address, not an ambiguity", () => {
  const lead = extractLead({ email: "Jana@Example.cz", email_address: "jana@example.cz" }, []);
  assert.equal(lead.email, "Jana@Example.cz", "case-insensitive dedupe, original casing preserved");
});

test("a Czech email alias still resolves as the single address", () => {
  const lead = extractLead({ "Jméno": "Petr", "E-mailová adresa": "petr@example.cz" }, []);
  assert.equal(lead.email, "petr@example.cz");
});

test("yields empty name/email when nothing maps (caller decides the rejection)", () => {
  const lead = extractLead({ favourite_colour: "blue" }, []);
  assert.equal(lead.name, "");
  assert.equal(lead.email, "");
});

// ---------------------------------------------------------------------------
// extractLead — provided-only KO verdict
// ---------------------------------------------------------------------------

test("affirmative answers pass in both languages and form vocabularies", () => {
  const lead = extractLead({ ko_auth: "yes", ko_mode: "ANO", ko_lang: true }, KO);
  assert.deepEqual(lead.failedKoIds, []);
  assert.deepEqual(lead.ungatedKoIds, []);
});

test("explicit negatives fail the gate", () => {
  const lead = extractLead({ ko_auth: "no", ko_mode: "ne", ko_lang: false }, KO);
  assert.deepEqual(lead.failedKoIds, ["ko_auth", "ko_mode", "ko_lang"]);
});

test("an absent KO field is ungated, NOT failed — third-party forms may not ask", () => {
  const lead = extractLead({ name: "Jana", email: "j@x.cz" }, KO);
  assert.deepEqual(lead.failedKoIds, []);
  assert.deepEqual(lead.ungatedKoIds, KO);
});

test("an uninterpretable KO answer is ungated, not failed (mapping quirks must not discard)", () => {
  const lead = extractLead({ ko_auth: "maybe later", ko_mode: "yes" }, KO);
  assert.deepEqual(lead.failedKoIds, []);
  assert.deepEqual(lead.ungatedKoIds, ["ko_auth", "ko_lang"]);
});

test("mixed verdict: one explicit no fails while the unasked rest stay ungated", () => {
  const lead = extractLead({ ko_mode: "no", name: "J", email: "j@x.cz" }, KO);
  assert.deepEqual(lead.failedKoIds, ["ko_mode"]);
  assert.deepEqual(lead.ungatedKoIds, ["ko_auth", "ko_lang"]);
});

// ---------------------------------------------------------------------------
// extractLead — E5 campaign/creative attribution
// ---------------------------------------------------------------------------

test("maps UTM attribution fields", () => {
  const lead = extractLead({ utm_campaign: "spring-fe", utm_content: "v3", email: "j@x.cz" }, []);
  assert.equal(lead.campaign, "spring-fe");
  assert.equal(lead.variant, "v3");
});

test("maps ad-platform attribution names (campaign_name, ad_id)", () => {
  const lead = extractLead(
    { field_data: [{ name: "campaign_name", values: ["Spring FE"] }, { name: "ad_id", values: ["238471"] }] },
    []
  );
  assert.equal(lead.campaign, "Spring FE");
  assert.equal(lead.variant, "238471");
});

test("attribution is empty when the payload carries none", () => {
  const lead = extractLead({ name: "J", email: "j@x.cz" }, []);
  assert.equal(lead.campaign, "");
  assert.equal(lead.variant, "");
});
