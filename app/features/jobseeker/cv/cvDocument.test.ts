import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCvDocument, bulletsOf, cvLanguageOf, findContacts, formatDates, levelPips, parseRoleTitle, polishTerms, type CvImprovement } from "./cvDocument";

// A SYNTHETIC two-column CV as the extractor hands it over: the main column first, the
// sidebar's own ALL-CAPS skill groups after it, shouted header, line-wrapped bullets
// with an open hyphen, sloppy technology spellings and one misspelling. Nobody real.

const TEXT = [
  "JANA NOVÁKOVÁ",
  "DATA ENGINEER & ANALYST",
  "+420 777 123 456 jana.novakova@example.invalid github.com/jnovakova",
  "PROFILE",
  "Data engineer building batch and streaming pipelines for retail analytics.",
  "WORK EXPERIENCE",
  "Acme Retail, a.s. 4/2022 - 9/2025",
  "Data Engineer",
  "Pipeline design: nodejs services feeding postgres and mongo db through",
  "kafka. responsible for the rest api of the reporting layer; batch-to-",
  "stream migration. built dashboards for store managers.",
  "",
  "PIPELINES",
  "Postgres (senior)",
  "Kafka (medior)",
  "python/js scripting",
  "Continous delivery",
  "EDUCATION 2014 - 2019",
  "Czech Technical University",
  "Informatics",
].join("\n");

const PROFILE = {
  displayName: "JANA NOVÁKOVÁ",
  languages: ["Czech", "English"],
  educationDetail: "Informatics",
  skillClaims: [{ skill: "postgres", level: "strong" }, { skill: "kafka", level: "working" }],
  evidence: [
    {
      kind: "job",
      title: "Data Engineer — Acme Retail, a.s. (4/2022 - 9/2025)",
      text: "Pipeline design: nodejs services feeding postgres and mongo db through kafka. responsible for the rest api of the reporting layer; batch-to- stream migration. built dashboards for store managers.",
    },
  ],
};

const doc = buildCvDocument({ profile: PROFILE, preferences: { targetTitles: ["Platform Engineer"] }, cvSourceText: TEXT });

test("the shouted header becomes a name and the CV's own headline, not the target title", () => {
  assert.equal(doc.name, "Jana Nováková");
  assert.equal(doc.headline, "Data Engineer & Analyst");
  assert.equal(doc.lang, "en");
});

test("contacts are read from the header only", () => {
  assert.deepEqual(
    doc.contacts.map((c) => c.kind),
    ["email", "phone", "github"]
  );
  assert.equal(doc.contacts.find((c) => c.kind === "github")!.href, "https://github.com/jnovakova");
  // A date range further down is never a phone.
  assert.deepEqual(findContacts("NAME\nEXPERIENCE\nRole 2019 - 2020 2021 - 2022"), []);
});

test("a role reads as role, organisation and typographic dates", () => {
  assert.equal(doc.experience.length, 1);
  const role = doc.experience[0]!;
  assert.equal(role.role, "Data Engineer");
  assert.equal(role.org, "Acme Retail, a.s.");
  assert.equal(role.dates, "04/2022 – 09/2025");
});

test("bullets: lead phrase, canonical terms, tightened opener, rejoined hyphen, capitalised", () => {
  const [first, second] = doc.experience[0]!.bullets;
  assert.deepEqual(first, { lead: "Pipeline design", text: "Node.js services feeding PostgreSQL and MongoDB through Kafka." });
  assert.equal(second!.lead, null);
  assert.equal(second!.text, "Owned the REST API of the reporting layer; batch-to-stream migration.");
  assert.equal(doc.experience[0]!.bullets[2]!.text, "Built dashboards for store managers.");
});

test("the CV's own skill groups survive with their levels, spellings polished", () => {
  assert.equal(doc.skills.length, 1);
  assert.equal(doc.skills[0]!.title, "Pipelines");
  assert.deepEqual(doc.skills[0]!.items, [
    { name: "PostgreSQL", level: "senior" },
    { name: "Kafka", level: "medior" },
    { name: "Python/JS scripting", level: null },
    { name: "Continuous delivery", level: null },
  ]);
});

test("education comes from its block, with its dates", () => {
  assert.deepEqual(doc.education, [{ title: "Czech Technical University", detail: "Informatics", dates: "2014 – 2019" }]);
});

test("every change is listed, once, and nothing is invented", () => {
  const kinds = new Set(doc.improvements.map((i) => i.kind));
  for (const k of ["term", "spelling", "hyphen", "capital", "opener"] as const) assert.ok(kinds.has(k), k);
  assert.ok(doc.improvements.some((i) => i.before === "Continous" && i.after === "Continuous"));
  const keys = doc.improvements.map((i) => `${i.kind}:${i.before}->${i.after}`);
  assert.equal(new Set(keys).size, keys.length);
  // No number appears in the document that is not in the source.
  const numbers = JSON.stringify({ ...doc, improvements: [] }).match(/\d{3,}/g) ?? [];
  for (const n of numbers) assert.ok(TEXT.replace(/\s/g, "").includes(n) || n.startsWith("420"), `invented number ${n}`);
});

test("prose words that are also acronyms stay prose", () => {
  const log: CvImprovement[] = [];
  assert.equal(polishTerms("the rest of the team; Qa and soap opera", log), "the rest of the team; Qa and soap opera");
  assert.equal(polishTerms("Rest/Graph design, soap API, llms and apis", log), "REST/Graph design, SOAP API, LLMs and APIs");
  // The ".js" of a framework's name is part of the name, not a bare "js".
  assert.equal(polishTerms("NextJS/React, UIs in (Next.js) and python/js", log), "Next.js/React, UIs in (Next.js) and Python/JS");
});

test("no groups in the text: the profile's claims, strong first, one localised group", () => {
  const bare = buildCvDocument({ profile: PROFILE, preferences: { targetTitles: [] }, cvSourceText: "Jana\nSome line" });
  assert.equal(bare.skills.length, 1);
  assert.equal(bare.skills[0]!.title, null);
  assert.deepEqual(bare.skills[0]!.items.map((i) => i.name), ["PostgreSQL", "Kafka"]);
});

test("helpers", () => {
  assert.deepEqual(parseRoleTitle("Analyst at Bank (2019 - 2020)"), { role: "Analyst", org: "Bank", dates: "2019 - 2020" });
  assert.equal(formatDates("7/2026 - present"), "07/2026 – present");
  assert.equal(cvLanguageOf("Vývoj a správa aplikací v jazyce Java pro klienty se zaměřením na bankovnictví"), "cs");
  assert.equal(levelPips("Senior"), 3);
  assert.equal(levelPips(null), 0);
  assert.deepEqual(bulletsOf("", []), []);
});

test("a CV with no headline gets none: a target title never stands in for a held one", () => {
  const noHead = buildCvDocument({ profile: { displayName: "Jana" }, preferences: { targetTitles: ["AI Engineer"] }, cvSourceText: "Jana\njana@example.invalid" });
  assert.equal(noHead.headline, null);
});

test("an AI draft's paraphrase gives way to the CV's own lines, dates included, per employer mention", () => {
  const text = [
    "JANA NOVÁKOVÁ",
    "DATA ENGINEER",
    "WORK EXPERIENCE",
    "Acme Retail, a.s. 4/2022 - 9/2025",
    "Data Engineer",
    "Kafka streaming for store analytics in TypeScript.",
    "Beta Bank, a.s. 2019 - 2021",
    "Analyst",
    "Requirements for ATM software.",
    "Acme Retail, a.s. 2015 - 2018",
    "Junior Analyst",
    "Reporting in SQL.",
  ].join("\n");
  const profile = {
    displayName: "Jana Nováková",
    evidence: [
      { kind: "job", title: "Data Engineer at Acme Retail, a.s.", text: "Built streaming pipelines." },
      { kind: "job", title: "Analyst at Beta Bank, a.s.", text: "Worked on ATMs." },
      { kind: "job", title: "Junior Analyst at Acme Retail, a.s.", text: "Did reports." },
    ],
  };
  const doc = buildCvDocument({ profile, preferences: { targetTitles: [] }, cvSourceText: text });
  assert.equal(doc.headline, "Data Engineer", "the shouted name is never read back as the headline");
  assert.deepEqual(
    doc.experience.map((r) => [r.role, r.dates, r.bullets.map((b) => b.text).join(" ")]),
    [
      ["Data Engineer", "04/2022 – 09/2025", "Kafka streaming for store analytics in TypeScript."],
      ["Analyst", "2019 – 2021", "Requirements for ATM software."],
      ["Junior Analyst", "2015 – 2018", "Reporting in SQL."],
    ]
  );
});
