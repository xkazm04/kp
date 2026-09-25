import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCvDocument, CV_OBJECTIVE } from "./cvDocument";
import { demandFor, tailorCvDocument, tailorTargetsOf, targetKindOf } from "./cvTailor";

// A SYNTHETIC career changer, nobody real: eight years of analyst and QA work, then an AI
// consultancy. The CV is written the way they lived it — the past first everywhere — and
// the seeker's stated target is "AI Engineer".

const TEXT = [
  "PETRA SVOBODOVÁ",
  "BUSINESS & QA ANALYST",
  "petra.svobodova@example.invalid +420 777 000 111",
  "PROFILE",
  "Analyst with eight years in retail banking. Tested payment systems across three releases a year. Since 2025 I build LLM assistants for clients.",
  "WORK EXPERIENCE",
  "ANALYSIS",
  "Requirements",
  "Confluence",
  "Jira",
  "LLM RELATED",
  "Prompt engineering",
  "RAG",
  "LangChain",
  "Python",
  "EDUCATION 2010 - 2015",
  "Masaryk University",
].join("\n");

const PROFILE = {
  displayName: "PETRA SVOBODOVÁ",
  languages: ["Czech", "English"],
  evidence: [
    {
      kind: "job",
      title: "AI Consultant — Nova Labs (01/2025 - present)",
      text: "Stakeholder workshops: ran discovery sessions with business owners. RAG pipeline design: built retrieval over contract archives with LangChain and PostgreSQL. Wrote a prompt evaluation harness for LLM answers.",
    },
    {
      kind: "job",
      title: "QA Analyst — Acme Bank (2019 - 2024)",
      text: "Wrote regression suites in Selenium for the payments team. Built a Python script that sorts defect reports with an LLM.",
    },
    {
      kind: "job",
      title: "Business Analyst — Acme Bank (2016 - 2019)",
      text: "Gathered requirements with stakeholders across the rest of the bank. Documented processes in Confluence.",
    },
  ],
};

const DOC = buildCvDocument({ profile: PROFILE, preferences: { targetTitles: ["AI Engineer"] }, cvSourceText: TEXT });

const at = (skills: string[], missing: string[], state: "target" | "family" | "past" | "none" = "target", matchedTitle: string | null = "AI Engineer") => ({
  targetAlignment: { state, matchedTitle, targetFamilies: ["ai_ml"], pastFamily: "business_analysis" },
  matchedSkills: skills.map((skill) => ({ skill, provenance: "work" })),
  missingSkills: missing,
});

const POSTINGS = [
  at(["python", "LangChain"], ["PyTorch", "Kubernetes"]),
  at(["Python", "RAG"], ["PyTorch", "LLMs"]),
  at(["Python"], ["kubernetes", "REST"]),
  // Not at the target: never demand, whatever they ask for.
  at(["Confluence", "Jira"], ["SAP"], "past", null),
  at(["Python"], ["Spark"], "target", "Data Scientist"),
];

const TAILORED = tailorCvDocument(DOC, { target: "AI Engineer", postings: POSTINGS });

test("demand = the target postings' requirements, most asked first, order-independent", () => {
  const d = demandFor("AI Engineer", POSTINGS);
  assert.equal(d.source, "postings");
  assert.equal(d.postings, 3);
  assert.deepEqual(d.skills.slice(0, 3), [
    { skill: "Python", count: 3 },
    { skill: "Kubernetes", count: 2 },
    { skill: "PyTorch", count: 2 },
  ]);
  // Posting spellings meet the canonical ones: "LLMs" is LLM, "kubernetes" Kubernetes.
  assert.ok(d.skills.some((s) => s.skill === "LLMs"));
  assert.ok(!d.skills.some((s) => /confluence|jira|sap|spark/i.test(s.skill)), "only postings AT the target count");
  assert.deepEqual(demandFor("AI Engineer", [...POSTINGS].reverse()), d);
});

test("no target posting yet: the kind's lexicon stands in, and says so", () => {
  const d = demandFor("Senior ML Engineer (LLM)", []);
  assert.equal(d.source, "lexicon");
  assert.ok(d.skills.some((s) => s.skill === "RAG"));
  assert.equal(targetKindOf("Front-end Engineer"), "frontend");
  assert.equal(targetKindOf("Data Scientist"), null);
  assert.equal(demandFor("Data Scientist", null).source, "none");
});

test("the summary leads with its AI sentence; every sentence kept verbatim", () => {
  const s = TAILORED.doc.summary!;
  assert.ok(s.startsWith("Since 2025 I build LLM assistants for clients."), s);
  for (const sentence of DOC.summary!.split(/(?<=\.)\s+/)) assert.ok(s.includes(sentence), sentence);
  assert.equal(s.length, DOC.summary!.length);
});

test("roles stay in date order; inside each, the relevant bullets lead", () => {
  assert.deepEqual(
    TAILORED.doc.experience.map((r) => r.role),
    DOC.experience.map((r) => r.role)
  );
  const [ai, qa, ba] = TAILORED.doc.experience;
  // The target's own subject (LLM, for an AI Engineer) weighs as much as the most-asked
  // skill, so the LLM harness leads, the RAG work follows, the workshops close.
  assert.deepEqual(
    ai!.bullets.map((b) => b.lead ?? b.text.slice(0, 14)),
    ["Wrote a prompt", "RAG pipeline design", "Stakeholder workshops"]
  );
  assert.match(qa!.bullets[0]!.text, /Python script/);
  // Nothing relevant in it: order untouched, and no compacting unless asked.
  assert.deepEqual(ba!.bullets.map((b) => b.text), DOC.experience[2]!.bullets.map((b) => b.text));
  assert.equal(ba!.compact, undefined);
  assert.equal(TAILORED.offTargetRoles, 1);
  // Same bullets, only reordered.
  for (let i = 0; i < DOC.experience.length; i++) {
    const sorted = (bs: { lead: string | null; text: string }[]) => bs.map((b) => `${b.lead}|${b.text}`).sort();
    assert.deepEqual(sorted(TAILORED.doc.experience[i]!.bullets), sorted(DOC.experience[i]!.bullets));
  }
});

test("a demanded term inside a bullet is marked for bold, and only a demanded term", () => {
  const demanded = new Set(demandFor("AI Engineer", POSTINGS).skills.map((s) => s.skill.toLowerCase().replace(/s$/, "")));
  let marks = 0;
  for (const r of TAILORED.doc.experience) {
    for (const b of r.bullets) {
      for (const [s, e] of b.emphasis ?? []) {
        marks++;
        assert.ok(demanded.has(b.text.slice(s, e).toLowerCase().replace(/s$/, "")), b.text.slice(s, e));
      }
    }
  }
  assert.ok(marks >= 2);
  // "the rest of the bank" is prose, never the REST the postings ask for.
  const ba = TAILORED.doc.experience[2]!;
  assert.ok(!(ba.bullets.some((b) => b.emphasis?.length)));
});

test("skills: the LLM group first, relevant items first, nothing removed", () => {
  const groups = TAILORED.doc.skills;
  assert.equal(groups[0]!.title, "LLM Related");
  assert.deepEqual(groups[0]!.items.slice(0, 3).map((i) => i.name).sort(), ["LangChain", "Python", "RAG"]);
  assert.ok(groups[0]!.items.find((i) => i.name === "Python")!.emphasis);
  assert.deepEqual(groups.flatMap((g) => g.items.map((i) => i.name)).sort(), DOC.skills.flatMap((g) => g.items.map((i) => i.name)).sort());
});

test("the headline stays the CV's own; the objective states the seeker's target as sought", () => {
  assert.equal(TAILORED.doc.headline, "Business & QA Analyst");
  assert.equal(TAILORED.doc.objective, "Seeking: AI Engineer roles");
  assert.equal(tailorCvDocument(DOC, { target: "AI Engineer", postings: POSTINGS, options: { objective: false } }).doc.objective, null);
  // A headline that already says the target needs no second line.
  assert.equal(tailorCvDocument({ ...DOC, headline: "Senior AI Engineer" }, { target: "AI Engineer", postings: POSTINGS }).doc.objective, null);
  assert.equal(CV_OBJECTIVE.cs("AI Engineer"), "Hledám pozici: AI Engineer");
});

test("no word in the tailored CV that is not in the CV or the seeker's own target", () => {
  // Emphasis ranges are character offsets, not words: they are left out of the reading.
  const words = (v: unknown) =>
    new Set((JSON.stringify(v, (k, val: unknown) => (k === "emphasis" ? undefined : val)).match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase()));
  const strip = (d: typeof DOC) => ({ ...d, improvements: [] });
  const allowed = new Set([...words(strip(DOC)), ...words("AI Engineer"), ...words(CV_OBJECTIVE.en("")), "objective", "compact", "true"]);
  for (const w of words(strip(TAILORED.doc))) assert.ok(allowed.has(w), `invented word: ${w}`);
  const compact = tailorCvDocument(DOC, { target: "AI Engineer", postings: POSTINGS, options: { compactOffTarget: true } });
  for (const w of words(strip(compact.doc))) assert.ok(allowed.has(w), `invented word: ${w}`);
});

test("compactOffTarget sets a role with nothing relevant as one line, in its place", () => {
  const out = tailorCvDocument(DOC, { target: "AI Engineer", postings: POSTINGS, options: { compactOffTarget: true } });
  assert.deepEqual(out.doc.experience.map((r) => !!r.compact), [false, false, true]);
  assert.ok(out.moves.some((m) => m.move === "compact" && m.where === "Business Analyst"));
  // Never when it would leave no full role.
  const none = tailorCvDocument(DOC, { target: "Pastry Chef", postings: [], options: { compactOffTarget: true } });
  assert.ok(none.doc.experience.every((r) => !r.compact));
});

test("every move is listed as a tailor improvement", () => {
  const kinds = TAILORED.moves.map((m) => m.move);
  for (const k of ["summary", "bullets", "groups", "emphasis", "objective"] as const) assert.ok(kinds.includes(k), k);
  assert.ok(TAILORED.moves.every((m) => m.kind === "tailor"));
  assert.deepEqual(TAILORED.doc.improvements.filter((i) => i.kind === "tailor"), TAILORED.moves);
  assert.deepEqual(TAILORED.doc.improvements.filter((i) => i.kind !== "tailor"), DOC.improvements);
  const bullets = TAILORED.moves.find((m) => m.move === "bullets" && m.where === "AI Consultant")!;
  assert.equal(bullets.before, "Stakeholder workshops: ran discovery sessions with business…");
  assert.equal(bullets.after, "Wrote a prompt evaluation harness for LLM answers.");
});

test("coverage: what the CV shows and where, what it does not (for the seeker only)", () => {
  const c = TAILORED.coverage;
  assert.equal(c.source, "postings");
  assert.equal(c.postings, 3);
  const python = c.shown.find((s) => s.skill === "Python")!;
  assert.deepEqual(python.where, [{ kind: "skills" }, { kind: "role", role: "QA Analyst" }]);
  assert.ok(c.shown.some((s) => s.skill === "LLMs"));
  assert.deepEqual(c.missing.map((m) => m.skill).sort(), ["Kubernetes", "PyTorch", "REST"]);
  // The missing skills never reach the sheet.
  const sheet = JSON.stringify({ ...TAILORED.doc, improvements: [] });
  for (const m of c.missing) assert.ok(!sheet.includes(m.skill), m.skill);
});

test("the designer's target list: blank titles dropped, each with its demand", () => {
  const targets = tailorTargetsOf(["AI Engineer", "  ", "QA Engineer"], POSTINGS);
  assert.deepEqual(targets.map((t) => t.title), ["AI Engineer", "QA Engineer"]);
  assert.equal(targets[0]!.demand.source, "postings");
  assert.equal(targets[1]!.demand.source, "lexicon");
});
