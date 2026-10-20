import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCvDocument, formatDates } from "./cvDocument";
import { acceptedEditsOf, applyAcceptedEdits, descriptorIn, languageLines, outcomeRung, SKILL_CAP } from "./cvContent";
import { tailorCvDocument } from "./cvTailor";

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

test("skills: the CV's own long list is read, evidenced items first, capped, nothing re-rated", () => {
  const items = CHANGER.skills.flatMap((g) => g.items);
  assert.ok(items.length <= SKILL_CAP && items.length >= 10, `${items.length} skills`);
  // Evidenced in the most recent role first (LangChain, RAG, PostgreSQL? no: Python, LLM…).
  assert.deepEqual(items.slice(0, 3).map((i) => i.name), ["Python", "LangChain", "RAG"]);
  // The level stays the CV's own WORD; nothing is drawn as a meter.
  assert.equal(items.find((i) => i.name === "Python")!.level, "senior");
  for (const i of items) assert.deepEqual(Object.keys(i).sort(), ["level", "name"]);
  // What the cap held back stays on its group, unprinted.
  const held = CHANGER.skills.flatMap((g) => g.trimmed ?? []).map((i) => i.name);
  assert.equal(items.length + held.length, 20);
  assert.ok(held.includes("Teamwork"), "an unevidenced soft skill is the first to go");
});

test("a listed-only skill is asked about, never deleted; a soft skill is a self-descriptor", () => {
  const listed = CHANGER.questions.filter((q) => q.kind === "listed_only").map((q) => q.text);
  for (const s of ["Power BI", "Tableau", "SAP", "Scrum", "Kanban", "Docker", "Git"]) assert.ok(listed.includes(s), s);
  // Used in a role: not asked. ("Excel" is in the junior role, "UML" in the analyst one.)
  for (const s of ["Python", "LangChain", "Selenium", "Excel", "UML"]) assert.ok(!listed.includes(s), s);
  const soft = CHANGER.questions.filter((q) => q.kind === "self_descriptor" && q.roleIndex === null).map((q) => q.text);
  for (const s of ["Communication", "Leadership", "Teamwork"]) assert.ok(soft.includes(s), s);
});

test("languages: CEFR codes and a native word on the scale the reader knows", () => {
  assert.deepEqual(CHANGER.languages, ["Czech – native", "English – C1", "German – B1"]);
  assert.deepEqual(languageLines(["čeština (rodilý mluvčí), angličtina (C1), němčina (pokročilá)"], [], "cs"), [
    "Čeština – rodilý mluvčí",
    "Angličtina – C1",
    "Němčina – pokročilá",
  ]);
  // No level stated: none rendered, none inferred.
  assert.deepEqual(languageLines(null, ["Czech", "English (b2)"], "en"), ["Czech", "English – B2"]);
});

test("relevant projects: non-job evidence, dated, never the choir", () => {
  assert.deepEqual(
    CHANGER.projects.map((p) => [p.role, p.dates, p.bullets.length > 0]),
    [
      ["Housing co-op chatbot", "2024", true],
      ["Machine Learning course, Coursera", "2023", true],
    ]
  );
  assert.ok(!JSON.stringify(CHANGER).includes("choir"));
});

test("tailored: bold capped at two terms per role, none in the skills, each a verbatim word of its bullet", () => {
  const out = tailorCvDocument(CHANGER, { target: "AI Engineer", postings: [] });
  for (const r of out.doc.experience) {
    const terms = r.bullets.flatMap((b) => b.emphasis);
    assert.ok(terms.length <= 2, `${r.role}: ${terms.join(", ")}`);
    for (const b of r.bullets) for (const t of b.emphasis) assert.ok(b.text.includes(t), t);
  }
  assert.ok(out.doc.experience[0]!.bullets.some((b) => b.emphasis.length > 0));
  for (const g of out.doc.skills) for (const i of g.items) assert.ok(!("emphasis" in i));
  // Projects that speak to the target stay, the most relevant first.
  assert.equal(out.doc.projects.length, 2);
  // A target neither project speaks to: they leave the tailored sheet, and the move says so.
  const fe = tailorCvDocument(CHANGER, { target: "Frontend Developer", postings: [] });
  assert.deepEqual(fe.doc.projects, []);
  assert.ok(fe.moves.some((m) => m.move === "projects" && m.n === 2));
});

test("dates are typeset for the document's market: the word for 'present' follows its language", () => {
  assert.equal(CHANGER.market, "en");
  assert.equal(CHANGER.experience[0]!.dates, "01/2024 – present");
  const cs = [
    "PETRA NOVÁ",
    "ANALYTIČKA",
    "PRACOVNÍ ZKUŠENOSTI",
    "Banka a.s. 3/2020 - současnost",
    "Analytička",
    "Vedla jsem analýzu požadavků pro nový systém a psala specifikace pro vývojáře v týmu.",
  ].join("\n");
  const doc = buildCvDocument({
    profile: { displayName: "Petra Nová", evidence: [{ kind: "job", title: "Analytička — Banka a.s.", text: "" }] },
    preferences: { targetTitles: [] },
    cvSourceText: cs,
    today: TODAY,
  });
  assert.equal(doc.market, "cs");
  assert.equal(doc.experience[0]!.dates, "03/2020 – dosud");
  assert.equal(formatDates("2019 - now", "de"), "2019 – heute");
  assert.equal(formatDates("09/2021 - present", "fr"), "09/2021 – aujourd'hui");
  // A closed range is only typeset, never completed or moved.
  assert.equal(formatDates("7/2016 - 2019", "cs"), "07/2016 – 2019");
});

test("no personal data by default: birth date, marital status, nationality, photo never reach the sheet", () => {
  const text = [
    "JANA NOVÁKOVÁ",
    "Married",
    "Date of birth: 12.03.1990",
    "jana@example.invalid",
    "PERSONAL DETAILS",
    "Nationality: Czech",
    "Marital status: married",
    "Children: 2",
    "Photo: attached",
    "WORK EXPERIENCE",
    "Acme Retail, a.s. 2022 - 2025",
    "Data Engineer",
    "Built batch pipelines for retail analytics.",
    "SKILLS",
    "Python, SQL",
  ].join("\n");
  const doc = buildCvDocument({
    profile: { displayName: "Jana Nováková", evidence: [{ kind: "job", title: "Data Engineer — Acme Retail, a.s. (2022 - 2025)", text: "" }] },
    preferences: { targetTitles: [] },
    cvSourceText: text,
    today: TODAY,
  });
  assert.equal(doc.headline, null, "a marital status is never read as a headline");
  const sheet = JSON.stringify(doc);
  for (const leak of ["Married", "married", "1990", "Nationality", "Czech", "Children", "Photo", "birth"]) assert.ok(!sheet.includes(leak), leak);
  // The model has no field for any of it: no photo, birth date, marital status or signature.
  for (const key of ["photo", "birthDate", "dateOfBirth", "maritalStatus", "nationality", "signature"]) assert.ok(!(key in doc), key);
  assert.deepEqual(doc.skills.flatMap((g) => g.items.map((i) => i.name)), ["Python", "SQL"]);
});

test("an ACCEPTED polish edit reaches the designed CV; a suggestion the seeker did not accept never does", () => {
  const accepted = { before: "Responsible for client workshops.", after: "Ran client workshops." };
  const offered = { before: "Documented the architecture in Confluence.", after: "Documented the platform architecture in Confluence." };
  const dialogs = [
    { kind: "fit", createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z", artifact: { applied: [{ ...offered, section: "x", promptVersion: "v" }] } },
    {
      kind: "cv_polish",
      createdAt: "2026-09-21T10:00:00Z",
      updatedAt: "2026-09-21T11:00:00Z",
      // `suggestions` is what was OFFERED; only `applied` is what the seeker accepted.
      artifact: { cvMarkdown: "# x", suggestions: [{ section: "Experience", ...offered, why: "", kind: "rewrite" }], applied: [{ section: "Experience", ...accepted, promptVersion: "cv-polish-v3" }] },
    },
  ];
  const edits = acceptedEditsOf(dialogs);
  assert.deepEqual(edits, [accepted], "fit dialogs and unaccepted suggestions carry nothing");
  const doc = buildCvDocument({ profile: CHANGER_PROFILE, preferences: { targetTitles: [] }, cvSourceText: CHANGER_CV, today: TODAY, acceptedEdits: edits });
  const lines = doc.experience[0]!.bullets.concat(doc.experience[0]!.trimmed ?? []).map(lineOf);
  assert.ok(lines.includes("Ran client workshops."), lines.join(" | "));
  assert.ok(!lines.includes("Responsible for client workshops."));
  assert.ok(lines.includes("Documented the architecture in Confluence."), "an offered rewrite the seeker did not accept is not on the sheet");
  assert.ok(!JSON.stringify(doc).includes("platform architecture"));
  // Without the edits, the sheet is the CV as written.
  assert.ok(CHANGER.experience[0]!.bullets.map(lineOf).includes("Responsible for client workshops."));
});

test("an accepted edit is bound to the line it judged: a CV that no longer holds the line drops it", () => {
  assert.equal(applyAcceptedEdits("Built X. Ran Y.", [{ before: "Ran Y.", after: "Ran Y weekly." }]), "Built X. Ran Y weekly.");
  assert.equal(applyAcceptedEdits("Built X. Ran Z.", [{ before: "Ran Y.", after: "Ran Y weekly." }]), "Built X. Ran Z.");
  // A later acceptance for the same line wins; each line is edited once.
  const later = acceptedEditsOf([
    { kind: "cv_polish", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", artifact: { applied: [{ before: "Ran Y.", after: "First." }] } },
    { kind: "cv_polish", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", artifact: { applied: [{ before: "Ran Y.", after: "Second." }] } },
  ]);
  assert.deepEqual(later, [{ before: "Ran Y.", after: "Second." }]);
});

test("tailoring keeps every skill question the base sheet raised (listed-only and soft skills)", () => {
  const out = tailorCvDocument(CHANGER, { target: "AI Engineer", postings: [] });
  const skillQs = (qs: typeof CHANGER.questions) => qs.filter((q) => q.roleIndex === null && CHANGER.skills.concat().some((g) => [...g.items, ...(g.trimmed ?? [])].some((i) => i.name === q.text)));
  assert.deepEqual(skillQs(out.doc.questions), skillQs(CHANGER.questions));
  assert.ok(out.doc.questions.some((q) => q.kind === "self_descriptor" && q.text === "Teamwork"));
});

test("a hyphenated language name is a name, a spaced hyphen still separates its level", () => {
  assert.deepEqual(languageLines(null, ["Swiss-German", "English - C1", "German – B2"], "en"), ["Swiss-German", "English – C1", "German – B2"]);
});
