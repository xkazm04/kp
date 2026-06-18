import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_TTL_DAYS,
  consentExpiresAt,
  consentStatus,
  maskCandidateName,
  outreachSuppressionReason,
  scrubPiiFromPayload,
  type ConsentSnapshot,
} from "./consent.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-17T00:00:00.000Z");

test("outreach suppression: anonymized and expired-consent candidates are not contactable", () => {
  // The compliance gate the outreach/rediscovery path consults before sending.
  const anon: ConsentSnapshot = { givenAt: "x", expiresAt: new Date(NOW + 200 * DAY).toISOString(), anonymizedAt: "y" };
  assert.equal(outreachSuppressionReason(anon, NOW), "anonymized");
  const expired: ConsentSnapshot = { givenAt: "x", expiresAt: new Date(NOW - DAY).toISOString(), anonymizedAt: null };
  assert.equal(outreachSuppressionReason(expired, NOW), "consent_expired");
});

test("outreach suppression: active / expiring / none / open-ended candidates ARE contactable", () => {
  const active: ConsentSnapshot = { givenAt: "x", expiresAt: new Date(NOW + 200 * DAY).toISOString(), anonymizedAt: null };
  assert.equal(outreachSuppressionReason(active, NOW), null);
  const expiring: ConsentSnapshot = { givenAt: "x", expiresAt: new Date(NOW + 10 * DAY).toISOString(), anonymizedAt: null };
  assert.equal(outreachSuppressionReason(expiring, NOW), null); // still valid, just near expiry
  const none: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: null };
  assert.equal(outreachSuppressionReason(none, NOW), null); // recruiter-sourced, never applied
  const openEnded: ConsentSnapshot = { givenAt: "x", expiresAt: null, anonymizedAt: null };
  assert.equal(outreachSuppressionReason(openEnded, NOW), null);
});

test("consentExpiresAt defaults to a 365-day window", () => {
  const given = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(consentExpiresAt(given), new Date(given + CONSENT_TTL_DAYS * DAY).toISOString());
  assert.equal(consentExpiresAt(given, 30), new Date(given + 30 * DAY).toISOString());
});

test("consentStatus walks none → active → expiring → expired, and anonymized wins", () => {
  const base: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: null };
  assert.equal(consentStatus(base, NOW), "none");

  // granted, expiry far out
  assert.equal(
    consentStatus({ givenAt: "x", expiresAt: new Date(NOW + 200 * DAY).toISOString(), anonymizedAt: null }, NOW),
    "active"
  );
  // within 30 days of expiry
  assert.equal(
    consentStatus({ givenAt: "x", expiresAt: new Date(NOW + 10 * DAY).toISOString(), anonymizedAt: null }, NOW),
    "expiring"
  );
  // past expiry
  assert.equal(
    consentStatus({ givenAt: "x", expiresAt: new Date(NOW - DAY).toISOString(), anonymizedAt: null }, NOW),
    "expired"
  );
  // anonymized overrides even a still-valid expiry
  assert.equal(
    consentStatus({ givenAt: "x", expiresAt: new Date(NOW + 200 * DAY).toISOString(), anonymizedAt: "y" }, NOW),
    "anonymized"
  );
  // granted, no expiry recorded → treated as active (legacy)
  assert.equal(consentStatus({ givenAt: "x", expiresAt: null, anonymizedAt: null }, NOW), "active");
});

test("maskCandidateName reduces to First L. and degrades safely", () => {
  assert.equal(maskCandidateName("Monika Marešová"), "Monika M.");
  assert.equal(maskCandidateName("  jan  novák  "), "Jan N.");
  assert.equal(maskCandidateName("Anna Maria Nováková"), "Anna N."); // first + last initial
  // diacritic last initial is uppercased codepoint-safely
  assert.equal(maskCandidateName("Petr Žižka"), "Petr Ž.");
  // single token → abbreviated, never the full token
  assert.equal(maskCandidateName("Madonna"), "Ma.");
  // empty / whitespace / null → neutral handle
  assert.equal(maskCandidateName(""), "Candidate");
  assert.equal(maskCandidateName(null), "Candidate");
  // CV-header stopwords are skipped, not masked
  assert.equal(maskCandidateName("Curriculum Vitae"), "Candidate");
});

test("maskCandidateName output carries no full surname", () => {
  const masked = maskCandidateName("Monika Marešová");
  assert.ok(!masked.includes("Marešová"));
  assert.match(masked, /^[^ ]+ [^ ]\.$/);
});

test("scrubPiiFromPayload blanks PII but retains scoring signal", () => {
  const profile = {
    candidate: {
      name: "Monika Marešová",
      rawText: "Monika Marešová\nmonika@example.com\n+420 777 888 999\n10y backend...",
      email: "monika@example.com",
      yearsExperience: 10,
      skills: ["React", "Node.js"],
      evidence: ["Led the payments team — Monika Marešová"],
    },
    score: { total: 82, skills: 90 },
    roleFamily: "software_engineering",
  };
  const scrubbed = scrubPiiFromPayload(profile) as typeof profile;

  // PII gone
  assert.equal(scrubbed.candidate.name, "");
  assert.equal(scrubbed.candidate.rawText, "");
  assert.equal(scrubbed.candidate.email, "");
  assert.deepEqual(scrubbed.candidate.evidence, []);
  // scoring + skills retained verbatim (the re-engagement signal)
  assert.equal(scrubbed.candidate.yearsExperience, 10);
  assert.deepEqual(scrubbed.candidate.skills, ["React", "Node.js"]);
  assert.equal(scrubbed.score.total, 82);
  assert.equal(scrubbed.roleFamily, "software_engineering");
  // no original PII string survives anywhere in the blob
  assert.ok(!JSON.stringify(scrubbed).includes("Marešová"));
  assert.ok(!JSON.stringify(scrubbed).includes("monika@example.com"));
  // input not mutated
  assert.equal(profile.candidate.name, "Monika Marešová");
});

test("scrubPiiFromPayload tolerates non-object input", () => {
  assert.equal(scrubPiiFromPayload(null), null);
  assert.equal(scrubPiiFromPayload("plain"), "plain");
  assert.equal(scrubPiiFromPayload(42), 42);
});
