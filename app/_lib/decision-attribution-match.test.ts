// One sealed Match verdict, every reader's language (ADR 0018). The record holds codes and
// numbers; the words come from the reader's own `match` catalog through the ONE renderer
// the Match card uses — so the same record reads in English and in Czech, and a record
// that is not a valid verdict reads as nothing rather than as a half-sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchVerdictReasons, sealedMatchFacts, sealedMatchVerdictOf } from "./decision-attribution.ts";
import type { MatchReasonsTranslator } from "../features/insights/matrix/focus/matchReasons.ts";

/** A translator over the REAL `match` namespace of one locale, ICU-lite ({name} only). */
function matchCatalog(locale: string): MatchReasonsTranslator {
  const match = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")).match;
  const lookup = (key: string): string | undefined =>
    key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), match) as string | undefined;
  return Object.assign(
    (key: string, values?: Record<string, string | number>) =>
      (lookup(key) ?? `?${key}`).replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")),
    { has: (key: string) => lookup(key) !== undefined }
  );
}

const FACTS = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java", "Kafka"],
  unproven: ["Go"],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};
const record = (over: Partial<{ kind: string; reasonCode: string; createdAt: string; payloadJson: string }> = {}) => ({
  kind: "match_verdict",
  reasonCode: "match_fit",
  createdAt: "2026-10-07T10:00:00.000Z",
  payloadJson: JSON.stringify({ kind: "match_verdict", inputs: FACTS }),
  ...over,
});

test("the same sealed record renders in English and in Czech — one record, two readers", () => {
  const rec = record();
  const en = matchVerdictReasons(matchCatalog("en"), rec);
  const cs = matchVerdictReasons(matchCatalog("cs"), rec);
  assert.equal(
    en?.line,
    "Strong fit: strongest on Skills (82), weakest on Career (40). Skills: matches Java, Kafka; claims but has not yet proven Go; lacks Rust."
  );
  assert.equal(
    cs?.line,
    "Silná shoda: nejsilnější v oblasti Dovednosti (82), nejslabší v oblasti Kariéra (40). Dovednosti: shoduje se v: Java, Kafka; uvádí, ale zatím nedoložil: Go; chybí: Rust."
  );
  // The skill NAMES are the candidate's own and do not translate; the lists ride along.
  assert.deepEqual(en?.matched, cs?.matched);
  assert.deepEqual(en?.missing, ["Rust"]);
});

test("de and fr resolve the same record too — no key the renderer needs is missing from a catalog", () => {
  for (const locale of ["de", "fr"]) {
    const line = matchVerdictReasons(matchCatalog(locale), record())?.line ?? "";
    assert.ok(line.length > 0, locale);
    assert.doesNotMatch(line, /\?(fitTier|dims|reasons)\./, `${locale}: an unresolved key leaked`);
    assert.match(line, /82/);
  }
});

test("a record that is not a valid Match verdict renders nothing", () => {
  const en = matchCatalog("en");
  assert.equal(matchVerdictReasons(en, record({ kind: "rejected" })), null, "another kind");
  assert.equal(matchVerdictReasons(en, record({ reasonCode: "reject" })), null, "another reason code");
  assert.equal(matchVerdictReasons(en, record({ payloadJson: "{not json" })), null, "unreadable payload");
  assert.equal(
    matchVerdictReasons(en, record({ payloadJson: JSON.stringify({ inputs: { ...FACTS, fitTier: "excellent" } }) })),
    null,
    "facts outside the vocabulary"
  );
  assert.equal(sealedMatchFacts(record({ payloadJson: JSON.stringify({ inputs: "Strong fit." }) })), null, "prose is not facts");
});

test("sealedMatchVerdictOf picks the newest valid verdict among an entry's records (seq-DESC)", () => {
  const newest = record({ createdAt: "2026-10-07T12:00:00.000Z", payloadJson: JSON.stringify({ inputs: { ...FACTS, fitTier: "promising" } }) });
  const advanced = { kind: "advanced", reasonCode: "accept", createdAt: "2026-10-07T13:00:00.000Z", payloadJson: "{}" };
  const got = sealedMatchVerdictOf([advanced, newest, record()]);
  assert.equal(got?.createdAt, "2026-10-07T12:00:00.000Z");
  assert.equal(got?.facts.fitTier, "promising");
  assert.equal(sealedMatchVerdictOf([advanced]), null);
});
