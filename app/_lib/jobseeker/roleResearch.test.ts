import assert from "node:assert/strict";
import { test } from "node:test";
import { isFreshResearch, researchMarkets, researchTitles, roleResearchKey, roleResearchOf, roleResearchRecordOf, ROLE_RESEARCH_FRESH_DAYS } from "./roleResearch.ts";

test("titles are trimmed, de-duplicated case-folded and capped at five; markets are ISO-2", () => {
  assert.deepEqual(researchTitles([" AI Engineer ", "ai engineer", "LLM  Engineer", "", "A", "B", "C", "D"]), ["AI Engineer", "LLM Engineer", "A", "B", "C"]);
  assert.deepEqual(researchMarkets(["CZ", "de", "cz", "Germany", "at "]), ["cz", "de", "at"]);
});

test("the key is order- and case-insensitive, and differs by market", () => {
  const a = roleResearchKey(["AI Engineer", "LLM Engineer"], ["cz", "de"]);
  assert.equal(a, roleResearchKey(["llm engineer", "AI  Engineer".replace(/\s+/g, " ")], ["de", "cz"]));
  assert.notEqual(a, roleResearchKey(["AI Engineer", "LLM Engineer"], ["cz"]));
  assert.match(a, /^[0-9a-f]{24}$/);
});

test("an unsourced skill is never shown, and a dropped source re-indexes the rest", () => {
  const r = roleResearchOf({
    titles: ["AI Engineer"],
    markets: ["cz"],
    asOf: "2026-09-28",
    summary: "Python and LLM integration lead.",
    sources: [{ url: "javascript:alert(1)" }, { url: "https://example.org/report", title: "Report", read: "fetched" }, { url: "https://example.org/b" }],
    skills: [
      { skill: "Python", tier: "core", share: 0.47, why: "In nearly half of postings", sources: [1] },
      { skill: "RAG", tier: "weird", share: 3, sources: [0, 2] },
      { skill: "Rust", tier: "emerging", sources: [0] },
      { skill: "python", tier: "core", sources: [1] },
    ],
  })!;
  assert.deepEqual(r.sources.map((s) => s.url), ["https://example.org/report", "https://example.org/b"]);
  assert.equal(r.sources[1]!.read, "snippet", "not stated as fetched = a search result only");
  assert.deepEqual(r.skills.map((s) => [s.skill, s.tier, s.share, s.sources]), [
    ["Python", "core", 0.47, [0]],
    ["RAG", "common", null, [1]],
  ], "Rust pointed only at a dropped source; the second python is a duplicate");
  assert.equal(roleResearchOf({ skills: [{ skill: "X", sources: [] }], sources: [] }), null, "nothing sourced = no research");
});

test("only a real, young answer counts as fresh; a keyless miss is asked again", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const base = { key: "k", titles: ["AI Engineer"], markets: [], source: "llm", fallbackReason: null, model: "claude-sonnet-5-5", promptVersion: "role-research-v1" };
  const research = { skills: [{ skill: "Python", sources: [0] }], sources: [{ url: "https://example.org" }] };
  assert.equal(isFreshResearch(roleResearchRecordOf({ ...base, research, at: "2026-09-27T12:00:00Z" }), now), true);
  const old = new Date(now.getTime() - (ROLE_RESEARCH_FRESH_DAYS + 1) * 86_400_000).toISOString();
  assert.equal(isFreshResearch(roleResearchRecordOf({ ...base, research, at: old }), now), false);
  assert.equal(isFreshResearch(roleResearchRecordOf({ ...base, research: null, source: "deterministic", fallbackReason: "no_provider", at: "2026-09-28T11:00:00Z" }), now), false);
  assert.equal(isFreshResearch(null, now), false);
});
