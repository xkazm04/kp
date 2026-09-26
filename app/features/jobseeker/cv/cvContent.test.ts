import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCvDocument } from "./cvDocument";
import { descriptorIn, outcomeRung } from "./cvContent";

// The designed CV's content rules, held to registry recruiting/cv-content-construction.
// Every CV here is SYNTHETIC — nobody real.

const DUTY_CV = [
  "JANA NOVÁKOVÁ",
  "DATA ENGINEER",
  "jana@example.invalid",
  "PROFILE",
  "Results-driven data engineer. Builds batch pipelines for retail analytics.",
  "WORK EXPERIENCE",
  "Acme Retail, a.s. 2022 - 2025",
  "Data Engineer",
  "Responsible for the reporting layer. Passionate about clean data models.",
].join("\n");

const DUTY_PROFILE = {
  displayName: "Jana Nováková",
  evidence: [{ kind: "job", title: "Data Engineer — Acme Retail, a.s. (2022 - 2025)", text: "" }],
};

test("a verb never raises the claim: 'Responsible for' stays the seeker's words", () => {
  const doc = buildCvDocument({ profile: DUTY_PROFILE, preferences: { targetTitles: [] }, cvSourceText: DUTY_CV });
  const texts = doc.experience[0]!.bullets.map((b) => b.text);
  assert.ok(texts.includes("Responsible for the reporting layer."), texts.join(" | "));
  assert.ok(!JSON.stringify(doc).includes("Owned"), "no responsibility turned into ownership");
  assert.ok(!doc.improvements.some((i) => (i.kind as string) === "opener"));
});

test("a self-descriptor in the seeker's own text is flagged as a question, never deleted", () => {
  const doc = buildCvDocument({ profile: DUTY_PROFILE, preferences: { targetTitles: [] }, cvSourceText: DUTY_CV });
  assert.ok(doc.summary!.includes("Results-driven data engineer."), "the seeker's words stay on the sheet");
  const flagged = doc.questions.filter((q) => q.kind === "self_descriptor");
  assert.deepEqual(flagged, [
    { kind: "self_descriptor", roleIndex: null, text: "Results-driven data engineer." },
    { kind: "self_descriptor", roleIndex: 0, text: "Passionate about clean data models." },
  ]);
});

test("self-descriptors are read in the four languages the sheet writes", () => {
  assert.equal(descriptorIn("A results driven analyst"), "results driven");
  assert.equal(descriptorIn("Jsem cílevědomá a komunikativní analytička"), "cílevědomá");
  assert.equal(descriptorIn("Teamfähig und belastbar"), "Teamfähig");
  assert.equal(descriptorIn("Esprit d'équipe et rigueur"), "Esprit d'équipe");
  assert.equal(descriptorIn("Built the invoice matching service."), null);
});

// ── the MEASURE fixture: a SYNTHETIC analyst -> AI career changer, five roles ──────
// (mirrored in the lot's before/after measurement; nobody real)

const CHANGER_CV = [
  "TOMÁŠ HORÁK",
  "BUSINESS ANALYST & AI CONSULTANT",
  "tomas.horak@example.invalid +420 777 555 000 linkedin.com/in/thorak-example",
  "Date of birth: 12.03.1985",
  "PROFILE",
  "Results-driven analyst with twelve years in banking and retail. Since 2024 I build LLM assistants for clients. Passionate team player who loves data. Moving into AI engineering.",
  "WORK EXPERIENCE",
  "Nova Labs 01/2024 - present",
  "AI Consultant",
  "Responsible for client workshops. Built a RAG assistant over 40 000 contract pages with LangChain and PostgreSQL; review time fell from five days to two. Wrote a prompt evaluation harness for LLM answers. Ran weekly demos for the leadership team. Documented the architecture in Confluence. Improved the answer quality of the assistant. Maintained the Python codebase.",
  "Acme Bank 2019 - 2023",
  "QA Analyst",
  "Wrote regression suites in Selenium for the payments team. Tested payment systems across three releases a year. Reduced manual regression effort. Built a Python script that sorts defect reports with an LLM. Reported defects in Jira.",
  "Acme Bank 2015 - 2019",
  "Business Analyst",
  "Gathered requirements with stakeholders. Documented processes in Confluence. Modelled 30 processes in UML for the core banking migration. Ran backlog refinement. Trained new analysts.",
  "Retail Co 2010 - 2015",
  "Junior Analyst",
  "Prepared weekly sales reports in Excel. Maintained the product database. Supported store managers.",
  "Shop s.r.o. 2006 - 2009",
  "Sales Assistant",
  "Served customers. Handled the till.",
  "SKILLS",
  "Python (senior), SQL (senior), LangChain, RAG, Prompt engineering, Selenium, Jira, Confluence, UML, Excel, Power BI, Tableau, SAP, Scrum, Kanban, Docker, Git, Communication, Leadership, Teamwork",
  "LANGUAGES",
  "Czech (native), English (C1), German (B1)",
  "EDUCATION 2006 - 2010",
  "University of Economics, Prague",
  "Informatics and statistics",
].join("\n");

const CHANGER_PROFILE = {
  displayName: "Tomáš Horák",
  languages: ["Czech", "English", "German"],
  educationDetail: "Informatics and statistics",
  skillClaims: [{ skill: "Python", level: "strong" }, { skill: "SQL", level: "strong" }],
  evidence: [
    { kind: "job", title: "AI Consultant — Nova Labs (01/2024 - present)", text: "" },
    { kind: "job", title: "QA Analyst — Acme Bank (2019 - 2023)", text: "" },
    { kind: "job", title: "Business Analyst — Acme Bank (2015 - 2019)", text: "" },
    { kind: "job", title: "Junior Analyst — Retail Co (2010 - 2015)", text: "" },
    { kind: "job", title: "Sales Assistant — Shop s.r.o. (2006 - 2009)", text: "" },
    { kind: "project", title: "Housing co-op chatbot (2024)", text: "Built an LLM chatbot that answers residents' questions from the co-op's bylaws, with RAG over 120 pages." },
    { kind: "course", title: "Machine Learning course, Coursera (2023)", text: "Completed the course with a final project classifying support tickets in Python." },
    { kind: "extracurricular", title: "Choir member (2012 - 2020)", text: "Sang in the city choir." },
  ],
};

const TODAY = new Date("2026-09-26T12:00:00Z");
const CHANGER = buildCvDocument({ profile: CHANGER_PROFILE, preferences: { targetTitles: ["AI Engineer"] }, cvSourceText: CHANGER_CV, today: TODAY });
const lineOf = (b: { lead: string | null; text: string }) => (b.lead ? `${b.lead}: ${b.text}` : b.text);

test("the outcome ladder: an owner number, a stated scale, a before/after, the action alone", () => {
  assert.equal(outcomeRung("Built a RAG assistant over 40 000 contract pages; review time fell from five days to two."), 1);
  assert.equal(outcomeRung("Cut month-end close from five days to two."), 1);
  assert.equal(outcomeRung("Ran weekly demos for the leadership team."), 2);
  assert.equal(outcomeRung("Tested payment systems across three releases a year."), 2);
  assert.equal(outcomeRung("Replaced a manual spreadsheet process."), 3);
  assert.equal(outcomeRung("Reduced manual regression effort."), 3);
  assert.equal(outcomeRung("Maintained the Python codebase."), 4);
  // A year is a date, not an outcome.
  assert.equal(outcomeRung("Since 2024 I build LLM assistants for clients."), 4);
});

test("bullets are ranked by outcome inside a role; the source order breaks ties", () => {
  const ai = CHANGER.experience[0]!;
  assert.match(lineOf(ai.bullets[0]!), /40 000 contract pages/);
  assert.equal(lineOf(ai.bullets[1]!), "Ran weekly demos for the leadership team.");
  const rungs = ai.bullets.map((b) => outcomeRung(lineOf(b)));
  assert.deepEqual([...rungs].sort((a, b) => a - b), rungs, "strongest outcome first");
});

test("space is spent by recency: 6 / 4 / 4 / 2 bullets, a role past fifteen years on one line", () => {
  assert.deepEqual(
    CHANGER.experience.map((r) => [r.role, r.compact, r.bullets.length]),
    [
      ["AI Consultant", false, 6],
      ["QA Analyst", false, 4],
      ["Business Analyst", false, 4],
      ["Junior Analyst", false, 2],
      ["Sales Assistant", true, 0],
    ]
  );
  // Compress, never delete: every role keeps its title, employer and dates, and every
  // bullet held back stays on the role for the owner (and the tailoring pass) to restore.
  for (const r of CHANGER.experience) assert.ok(r.role && r.org && r.dates, r.role);
  assert.equal(CHANGER.experience[0]!.trimmed!.length, 1);
  assert.deepEqual(CHANGER.experience[4]!.trimmed!.map((b) => b.text), ["Served customers.", "Handled the till."]);
  // The weakest bullet is the one held back, never the strongest.
  assert.ok(CHANGER.experience[0]!.bullets.some((b) => /40 000/.test(b.text)));
});

test("a bullet with no outcome is an owner question, never a placeholder on the sheet", () => {
  const byKind = (k: string) => CHANGER.questions.filter((q) => q.kind === k);
  // Printed rung-4 bullets are asked about, with their role; held-back ones are not.
  const noOutcome = byKind("no_outcome");
  assert.ok(noOutcome.some((q) => q.roleIndex === 0 && q.text === "Responsible for client workshops."));
  assert.ok(!noOutcome.some((q) => q.text === "Maintained the Python codebase."), "held back by the budget, so not asked");
  for (const q of noOutcome) {
    const role = CHANGER.experience[q.roleIndex!]!;
    assert.ok(role.bullets.some((b) => lineOf(b) === q.text), `asked about a printed bullet: ${q.text}`);
  }
  assert.ok(!noOutcome.some((q) => q.roleIndex === 4), "a one-line role is not questioned");
  // A change stated without a measure asks for the metric.
  assert.deepEqual(
    byKind("missing_metric").map((q) => [q.roleIndex, q.text]),
    [
      [0, "Improved the answer quality of the assistant."],
      [1, "Reduced manual regression effort."],
    ]
  );
  // Nothing on the sheet reads like a slot to fill.
  const sheet = JSON.stringify({ ...CHANGER, questions: [], improvements: [] });
  assert.ok(!/\[(how much|\?)|\?\]|TODO|XX%/i.test(sheet));
});
