// Cohort Studio proposal (analyze-cohort-proposal.ts) over injected deps: the membership
// rules, the cap and what it leaves out, the reuse rule, the company text, the POST body.
// No Python and no store: the ranker and the readers are fakes. unit-db.ts still comes
// first — the module under test imports the real stores for its production wiring, and
// nothing may resolve the developer's own data/kp.sqlite.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  buildCohortProposal,
  composeCompanyText,
  displayMemberLabel,
  uniqueDisplayLabels,
  findReusableAnalysis,
  memberIdForSource,
  parseCohortRunRequest,
  sourceForMemberId,
  type ProposalDeps,
} from "./analyze-cohort-proposal.ts";
import { COHORT_CAP } from "../features/tools/analyze/cohort/cohortTypes.ts";
import type { AnalysisCohortCvFact, AnalysisCohortProfileFact } from "./db/analysis-cohorts.ts";
import type { JobRecord } from "./db/core.ts";

const WS = "workspace";

after(() => cleanupUnitDb());

type Person = { id: string; label: string; cvHash?: string | null; text?: boolean; profileOf?: string; jdSlug?: string | null; name?: string | null };

function deps(people: Person[], opts: { applicants?: string[]; ranked?: Array<{ id: string; total: number; ko?: boolean }>; job?: JobRecord | null; withheld?: string[] } = {}): ProposalDeps {
  const analyses = new Map<string, AnalysisCohortCvFact>();
  const profiles = new Map<string, AnalysisCohortProfileFact>();
  for (const p of people) {
    if (p.profileOf) {
      profiles.set(p.id, { id: p.id, label: p.label, roleFamily: "data_ai", sourceAnalysisSlug: p.profileOf, sourceCvHash: null });
    } else {
      analyses.set(p.id, {
        slug: p.id,
        label: p.label,
        jdSlug: p.jdSlug ?? null,
        cvHash: p.cvHash ?? null,
        roleFamily: "software_engineering",
        seniority: "senior",
        createdAt: "2026-10-01T00:00:00Z",
        hasCvText: p.text !== false,
        candidateName: p.name ?? null,
      });
    }
  }
  const job = opts.job === undefined ? ({ id: "jd-role", title: "Backend", company: "Acme s.r.o." } as JobRecord) : opts.job;
  return {
    cvFacts: (slugs) => new Map(slugs.flatMap((s) => (analyses.has(s) ? [[s, analyses.get(s)!] as const] : []))),
    profileFacts: (ids) => new Map(ids.flatMap((i) => (profiles.has(i) ? [[i, profiles.get(i)!] as const] : []))),
    withholdsPii: (label) => (opts.withheld ?? []).includes(label),
    loadJd: (slug) => (slug === "role" ? { slug, title: "Backend Engineer", build_input_json: JSON.stringify({ company: "Acme Payments" }) } : null),
    getJob: () => job,
    org: () => ({ name: "Česká spořitelna", domain: "csas.cz" }),
    listApplicants: () => (opts.applicants ?? []).map((id) => ({ candidateId: id, candidateLabel: id })),
    poolEntryExists: (id) => analyses.has(id) || profiles.has(id),
    buildPool: () => ({ entries: people.map((p) => ({ id: p.id, label: p.label, candidate: {} })), truncated: false }),
    rankPool: async () => ({
      candidates: (opts.ranked ?? []).map((r) => ({ candidateId: r.id, koPassed: r.ko !== false, result: { total: r.total } })),
    }),
    reuseRows: () =>
      people
        .filter((p) => p.jdSlug === "role")
        .map((p) => ({ slug: p.id, label: p.label, cvHash: p.cvHash ?? null, createdAt: "2026-10-02T00:00:00Z" })),
  };
}

test("member ids round-trip: an analysis slug, or profile:<id>", () => {
  assert.deepEqual(sourceForMemberId("an-1"), { kind: "analysis", slug: "an-1" });
  assert.deepEqual(sourceForMemberId("profile:p-1"), { kind: "profile", id: "p-1" });
  assert.equal(sourceForMemberId("profile:"), null);
  assert.equal(memberIdForSource({ kind: "profile", id: "p-1" }), "profile:p-1");
});

test("applicants come first, the matched top-up follows in rank order, and a no-CV entry is skipped", async () => {
  const people: Person[] = [
    { id: "app-1", label: "Applicant One" },
    { id: "app-2", label: "Applicant Two", text: false },
    { id: "m-1", label: "Matched One" },
    { id: "m-2", label: "Matched Two" },
    { id: "m-ko", label: "Matched KO" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, {
    applicants: ["app-1", "app-2"],
    ranked: [{ id: "m-2", total: 81 }, { id: "app-1", total: 77 }, { id: "m-ko", total: 75, ko: false }, { id: "m-1", total: 64 }],
  }));
  assert.ok(p);
  assert.deepEqual(p.members.map((m) => [m.memberId, m.membership]), [["app-1", "applicant"], ["m-2", "matched"], ["m-1", "matched"]]);
  assert.equal(p.members[0].matchScore, 77, "an applicant carries its rank score when the ranker scored it");
  assert.equal(p.members.find((m) => m.memberId === "m-ko"), undefined, "a KO-failed row is not a top-up");
  assert.equal(p.cap, COHORT_CAP);
  assert.deepEqual(p.leftOut, { applicants: 0, matched: 0 });
  assert.equal(p.jdTitle, "Backend Engineer");
});

test("the cap holds at COHORT_CAP and leftOut counts what it excluded, per rule", async () => {
  const people: Person[] = Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, label: `Person ${i}` }));
  const p = await buildCohortProposal("role", WS, deps(people, {
    applicants: people.slice(0, 22).map((x) => x.id),
    ranked: people.map((x, i) => ({ id: x.id, total: 90 - i })),
  }));
  assert.ok(p);
  assert.equal(p.members.length, COHORT_CAP);
  assert.ok(p.members.every((m) => m.membership === "applicant"));
  assert.deepEqual(p.leftOut, { applicants: 2, matched: 8 });
});

test("a profile and its own source analysis are ONE person (same CV)", async () => {
  const people: Person[] = [
    { id: "an-x", label: "Xena", cvHash: "hx" },
    { id: "prof-x", label: "Xena", profileOf: "an-x" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, { ranked: [{ id: "prof-x", total: 80 }, { id: "an-x", total: 70 }] }));
  assert.deepEqual(p?.members.map((m) => m.memberId), ["profile:prof-x"]);
  assert.deepEqual(p?.members[0].source, { kind: "profile", id: "prof-x" });
});

test("an earlier run of the same CV (no cv_hash, a new row, same person) does not enter twice", async () => {
  const people: Person[] = [
    { id: "seed-k", label: "Klára Blažková" },
    { id: "rerun-k", label: "Klára Blažková", jdSlug: "role" },
    { id: "other", label: "Other Person" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, {
    applicants: ["seed-k"],
    ranked: [{ id: "rerun-k", total: 90 }, { id: "other", total: 70 }],
  }));
  assert.deepEqual(p?.members.map((m) => m.memberId), ["seed-k", "other"]);
  assert.equal(p?.members[0].reusable, true, "…and the applicant reuses that earlier run");
});

test("reuse + freshCount: an analysis of the same CV already filed against this JD spends nothing", async () => {
  const people: Person[] = [
    { id: "old-run", label: "Reused Rita", cvHash: "h-rita", jdSlug: "role" },
    { id: "rita-src", label: "Reused Rita", cvHash: "h-rita" },
    { id: "fresh", label: "Fresh Fred", cvHash: "h-fred" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, { ranked: [{ id: "rita-src", total: 80 }, { id: "fresh", total: 70 }] }));
  assert.deepEqual(p?.members.map((m) => [m.memberId, m.reusable]), [["rita-src", true], ["fresh", false]]);
  assert.equal(p?.freshCount, 1);
});

test("a person whose PII is withheld (expired consent / erased) is not offered", async () => {
  const people: Person[] = [{ id: "w", label: "Withheld Wanda" }, { id: "ok", label: "Fine Filip" }];
  const p = await buildCohortProposal("role", WS, deps(people, { ranked: [{ id: "w", total: 90 }, { id: "ok", total: 80 }], withheld: ["Withheld Wanda"] }));
  assert.deepEqual(p?.members.map((m) => m.memberId), ["ok"]);
});

test("an unknown JD is no proposal; an un-ingested JD offers no top-up and never ranks", async () => {
  assert.equal(await buildCohortProposal("nope", WS, deps([])), null);
  const d = deps([{ id: "a", label: "A" }], { job: null, ranked: [{ id: "a", total: 90 }] });
  d.rankPool = async () => {
    throw new Error("must not rank without a job");
  };
  const p = await buildCohortProposal("role", WS, d);
  assert.deepEqual(p?.members, []);
});

test("the company text composes the org, the job's company and the build intent, de-duplicated", async () => {
  const p = await buildCohortProposal("role", WS, deps([]));
  assert.equal(p?.companyText, "Česká spořitelna (csas.cz)\nAcme s.r.o.\nAcme Payments");
  assert.equal(p?.orgName, "Česká spořitelna");
  assert.equal(composeCompanyText(null, "  ", null), null);
  assert.equal(composeCompanyText({ name: "Acme", domain: null }, "acme", "ACME"), "Acme");
});

test("the reuse rule: cv_hash when both carry one, else the source slug or the exact label", () => {
  const rows = [
    { slug: "r-hash", label: "Someone Else", cvHash: "h1", createdAt: "2026-10-02" },
    { slug: "r-label", label: "Label Match", cvHash: null, createdAt: "2026-10-01" },
  ];
  assert.equal(findReusableAnalysis({ cvSlug: "s", cvHash: "h1", label: "Anyone" }, rows), "r-hash");
  assert.equal(findReusableAnalysis({ cvSlug: "s", cvHash: "h2", label: "Someone Else" }, rows), null, "two hashes that differ never match by label");
  assert.equal(findReusableAnalysis({ cvSlug: "s", cvHash: null, label: "Label Match" }, rows), "r-label");
  assert.equal(findReusableAnalysis({ cvSlug: "r-label", cvHash: "h9", label: "x" }, rows), "r-label", "the source slug itself");
});

test("the POST body: shape, membership vocabulary, no repeated member", () => {
  assert.deepEqual(parseCohortRunRequest({ jdSlug: " role ", members: [{ memberId: "a", membership: "added" }], blind: true, reportLang: "cs" }), {
    jdSlug: "role",
    members: [{ memberId: "a", membership: "added" }],
    blind: true,
    reportLang: "cs",
  });
  assert.equal(parseCohortRunRequest({ jdSlug: "role", members: [{ memberId: "a", membership: "vip" }] }), null);
  assert.equal(parseCohortRunRequest({ jdSlug: "role", members: [{ memberId: "a", membership: "added" }, { memberId: "a", membership: "matched" }] }), null);
  assert.equal(parseCohortRunRequest({ jdSlug: "", members: [] }), null);
  assert.equal(parseCohortRunRequest({ jdSlug: "role", members: [], blind: "yes" }), null);
  assert.equal(parseCohortRunRequest(null), null);
});

test("a member is shown by the CV's own name, never the stored \"Name → Role\" label", async () => {
  assert.equal(displayMemberLabel("Martin Novotný", "Martin Novotný → Senior Java Backend Engineer"), "Martin Novotný");
  assert.equal(displayMemberLabel(null, "Vít Malý → Senior Java Backend Engineer"), "Vít Malý");
  assert.equal(displayMemberLabel("  ", "Aneta -> Lead"), "Aneta");
  assert.equal(displayMemberLabel(null, "Plain Label"), "Plain Label");
  const people: Person[] = [
    { id: "cv-1", label: "Martin Novotný → Senior Java Backend Engineer", name: "Martin Novotný" },
    { id: "cv-2", label: "Vít Malý → Senior Java Backend Engineer" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, { ranked: [{ id: "cv-1", total: 80 }, { id: "cv-2", total: 70 }] }));
  assert.deepEqual(p?.members.map((m) => m.label), ["Martin Novotný", "Vít Malý"]);
});

test("two different CVs carrying the same name stay distinguishable", async () => {
  assert.deepEqual(
    uniqueDisplayLabels([
      { displayLabel: "Vojtěch Hruška", label: "Aneta Kovářová → Senior Java" },
      { displayLabel: "Vojtěch Hruška", label: "David Kříž → Senior Java" },
      { displayLabel: "Tomáš Vavřík", label: "Vít Malý → Senior Java" },
      { displayLabel: "Same", label: "Same" },
      { displayLabel: "Same", label: "Same" },
    ]),
    ["Aneta Kovářová", "David Kříž", "Tomáš Vavřík", "Same", "Same (2)"]
  );
  const people: Person[] = [
    { id: "cv-5", label: "Aneta Kovářová → Senior Java", name: "Vojtěch Hruška" },
    { id: "cv-40", label: "David Kříž → Senior Java", name: "Vojtěch Hruška" },
  ];
  const p = await buildCohortProposal("role", WS, deps(people, { ranked: [{ id: "cv-5", total: 80 }, { id: "cv-40", total: 70 }] }));
  assert.deepEqual(p?.members.map((m) => m.label), ["Aneta Kovářová", "David Kříž"]);
});
