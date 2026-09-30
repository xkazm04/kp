// The client proposal's pure layers: the model-answer validator and its honesty gate (no
// invented price, field caps, the disclosure last), kp's own composition from a brief alone
// and from a brief + an accepted plan, the page template (escaping, NO internal figures), the
// file placement and its atomic write, the served root and the download name - plus the
// lockstep with gig_proposal_cli.py (prompt version, message cap). No DB, no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_FIXTURE_BRIEF, reportFixtureGig } from "../__fixtures__/report-facts.ts";
import { GIG_DISCLOSURE_SENTENCE } from "../contract.ts";
import { fixturePlan } from "../__fixtures__/accepted-plan.ts";
import { gigProposalPathFor, gigProposalsRoot, writeGigProposalFile } from "./file.ts";
import { GIG_PROPOSAL_MESSAGE_MAX, allowedMoneyFigures, deterministicProposal, honestText, parseGigProposalBody } from "./model.ts";
import { GIG_PROPOSAL_CSS } from "./proposal-css.ts";
import { GIG_PROPOSAL_PROMPT_VERSION, gigProposalCliInput } from "./run.ts";
import { proposalDownloadName, servedProposalsRoot } from "./serve.ts";
import { renderGigProposalPage } from "./template.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CLI = readFileSync(path.join(REPO, "pipeline", "jobfit", "gig_proposal_cli.py"), "utf8");
const D = GIG_DISCLOSURE_SENTENCE;
const OPTS = { rewardText: "€1,800", disclosure: D, fallbackTitle: "Checkout page too slow" };
const GOOD = {
  title: "Schnellerer Checkout",
  understanding: "Ihr Checkout soll auf dem Handy unter 2 Sekunden laden.",
  approach: ["Erst messen, dann ändern.", "Das Zahlungs-Widget bleibt unverändert."],
  milestones: [{ title: "Messung", delivers: "Ein Bericht mit den langsamsten Teilen." }],
  timeline: "Nach Ihren Antworten in wenigen Tagen.",
  effort: { minHours: 16, maxHours: 32 },
  questions: ["Welches Lighthouse-Profil nutzen Sie?"],
  artifacts: ["Lesezugriff auf Vercel Analytics"],
  message: `Hallo, ich würde zuerst messen. Können Sie mir Zugriff geben?\n\n${D}`,
};

test("parse: a good answer keeps its fields and ends the message with the disclosure once", () => {
  const b = parseGigProposalBody(GOOD, OPTS)!;
  assert.equal(b.title, "Schnellerer Checkout");
  assert.deepEqual(b.effort, { minHours: 16, maxHours: 32 });
  assert.ok(b.message.endsWith(D));
  assert.equal(b.message.split(D).length, 2);
});

test("parse: no price is invented - a sentence with a money figure the listing does not state is dropped", () => {
  assert.deepEqual([...allowedMoneyFigures("$250 - $400 USD")].sort(), ["250", "400"]);
  const b = parseGigProposalBody(
    {
      ...GOOD,
      understanding: "You need speed. My rate is $45/h. It stays within the posted budget of €1,800.",
      approach: ["A fixed price of 1500 EUR.", "Measure first."],
      message: "Hello! I charge 900 Kč per hour. I can start soon.",
    },
    OPTS
  )!;
  assert.equal(b.understanding, "You need speed. It stays within the posted budget of €1,800.");
  assert.deepEqual(b.approach, ["Measure first."]);
  assert.ok(b.message.startsWith("Hello! I can start soon."));
  assert.ok(b.message.endsWith(D), "the disclosure is added when the model left it out");
  assert.equal(honestText("Budget: 1.800 EUR. Rate: $20.", allowedMoneyFigures("€1,800")), "Budget: 1.800 EUR.");
});

test("parse: caps and refusals", () => {
  const b = parseGigProposalBody({ ...GOOD, understanding: "u".repeat(5000), questions: Array.from({ length: 20 }, (_, i) => `Q${i}?`), message: "m ".repeat(2000) }, OPTS)!;
  assert.equal(b.understanding.length, 900);
  assert.equal(b.questions.length, 8);
  assert.ok(b.message.length <= GIG_PROPOSAL_MESSAGE_MAX && b.message.endsWith(D));
  assert.equal(parseGigProposalBody({ ...GOOD, title: "" }, OPTS)!.title, "Checkout page too slow");
  assert.equal(parseGigProposalBody({ ...GOOD, effort: { minHours: 9, maxHours: 2 } }, OPTS)!.effort, null);
  for (const bad of [null, "x", [], { ...GOOD, understanding: " " }, { ...GOOD, approach: [] }, { ...GOOD, message: D }]) assert.equal(parseGigProposalBody(bad, OPTS), null);
});

test("deterministic: brief only - the brief's gist, its asks, the outreach message and a plan that follows the answers", () => {
  const gig = reportFixtureGig();
  const b = deterministicProposal(gig, null, D);
  assert.equal(b.title, gig.title);
  assert.match(b.understanding, /checkout page under 2 s LCP/);
  assert.deepEqual(b.milestones, []);
  assert.match(b.timeline, /detailed plan with milestones follows your answers/);
  assert.deepEqual(b.artifacts, REPORT_FIXTURE_BRIEF.missingArtifacts);
  assert.deepEqual(b.effort, { minHours: 16, maxHours: 32 }, "the brief's effort");
  assert.ok(b.message.startsWith("Hello, I can take this on.") && b.message.endsWith(D));
});

test("deterministic: brief + plan - the plan's steps are the milestones, its questions the questions", () => {
  const plan = { ...fixturePlan(4), questions: ["Which pages matter most?"] };
  const b = deterministicProposal(reportFixtureGig(), plan, D);
  assert.deepEqual(b.milestones.map((m) => [m.title, m.delivers]), plan.steps.map((s) => [s.title, s.doneWhen]));
  assert.deepEqual(b.questions, ["Which pages matter most?"]);
  assert.deepEqual(b.effort, { minHours: 2, maxHours: 5 }, "the plan's effort wins over the brief's");
  assert.equal(b.approach[0], plan.summary.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
  const bare = deterministicProposal({ ...reportFixtureGig(), brief: { ...REPORT_FIXTURE_BRIEF, outreachMessage: null, missingArtifacts: ["The logo"] } }, null, D);
  // The bid's shape: interest, what the work needs to START once agreed (nothing asked for now), a closing line.
  assert.match(bare.message, /^Hello, I read your listing for .+\n\nTo get started once we agree, I would need:\n- The logo\n\n.+\n\n/);
  assert.doesNotMatch(bare.message, /How I would approach it/, "no plan, no invented steps");
  const planned = deterministicProposal({ ...reportFixtureGig(), brief: { ...REPORT_FIXTURE_BRIEF, outreachMessage: null, missingArtifacts: [] } }, plan, D);
  assert.match(planned.message, /\n\nHow I would approach it:\n- .+\n/, "the plan's steps are the approach bullets");
  assert.doesNotMatch(planned.message, /To get started/, "nothing needed, no start list");
});

test("template: every field is escaped, and NO internal figure, id, model or tool name reaches the page", () => {
  const gig = reportFixtureGig({ title: `<script>alert("x")</script> Checkout` });
  const body = { ...deterministicProposal(gig, fixturePlan(4), D), understanding: `A <b>bold</b> & "quoted" need.` };
  const html = renderGigProposalPage({ body, language: "en", generatedAt: "2026-09-30T09:00:00.000Z", disclosure: D });
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; Checkout/);
  assert.match(html, /A &lt;b&gt;bold&lt;\/b&gt; &amp; &quot;quoted&quot; need\./);
  for (const internal of [/\bkp\b/i, /\bfit\b/i, /cost/i, /\$/, /claude|sonnet|opus|gpt/i, new RegExp(gig.id), /seat/i, /2106|0\.8547/]) assert.doesNotMatch(html, internal, String(internal));
  assert.match(html, /<th>What you receive<\/th>/);
  assert.match(html, /September 30, 2026/);
  assert.match(html, /<footer class="note"><p>This work was prepared with the assistance of an AI agent/);
  assert.doesNotMatch(GIG_PROPOSAL_CSS, /\bkp\b|url\(|@import/i);
  assert.match(GIG_PROPOSAL_CSS, /@page\{size:A4/);
  assert.match(GIG_PROPOSAL_CSS, /tr\{break-inside:avoid\}/);
});

test("template: the labels and the date follow the language; an unknown one falls back to English labels", () => {
  const body = parseGigProposalBody(GOOD, OPTS)!;
  const de = renderGigProposalPage({ body, language: "de", generatedAt: "2026-09-30T09:00:00.000Z", disclosure: D });
  assert.match(de, /<html lang="de">/);
  assert.match(de, /Was ich von Ihnen brauche/);
  assert.match(de, /30\. September 2026/);
  assert.match(de, /16-32 Stunden/);
  const es = renderGigProposalPage({ body, language: "es", generatedAt: "2026-09-30T09:00:00.000Z", disclosure: D });
  assert.match(es, /<html lang="es">/);
  assert.match(es, /What I need from you/);
});

test("file: <root>/<type>/<slug>.html inside the root, the recorded path kept, the write atomic with .prev.html", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kp-proposal-file-"));
  try {
    const gig = { ...reportFixtureGig(), proposal: null };
    const file = gigProposalPathFor(root, gig)!;
    assert.equal(file, path.join(root, "web", "2026-09-28-checkout-page-too-slow-next-js-a1b2c3.html"));
    assert.equal(gigProposalPathFor(root, { ...gig, proposal: { path: file } }), file);
    assert.equal(gigProposalPathFor(root, { ...gig, proposal: { path: path.resolve("/etc/passwd.html") } }), file, "a path outside the root is recomputed");
    writeGigProposalFile(file, "<p>one</p>");
    writeGigProposalFile(file, "<p>two</p>");
    assert.equal(readFileSync(file, "utf8"), "<p>two</p>");
    assert.equal(readFileSync(file.replace(/\.html$/, ".prev.html"), "utf8"), "<p>one</p>");
    assert.ok(!existsSync(`${file}.tmp`));
    for (const env of [{}, { KP_GIGS_ROOT: "D:/gigs" }, { KP_GIGS_ROOT: " ../other " }]) {
      assert.equal(servedProposalsRoot(env, "/repo/kp"), gigProposalsRoot({ env, repoRoot: "/repo/kp" }), JSON.stringify(env));
    }
    assert.equal(proposalDownloadName(file), "checkout-page-too-slow-next-js-proposal.html");
    assert.equal(proposalDownloadName("/x/weird name.html"), "weirdname-proposal.html");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli input: the listing, the brief (with its asks) and the plan; the language is the brief's", () => {
  const input = gigProposalCliInput(reportFixtureGig(), fixturePlan(4));
  assert.equal(input.language, "de");
  assert.equal(input.disclosure, D);
  assert.equal(input.listing.reward, "€1,800");
  assert.equal(input.listing.english, REPORT_FIXTURE_BRIEF.listingEnglish);
  assert.deepEqual((input.brief as { missingArtifacts: string[] }).missingArtifacts, REPORT_FIXTURE_BRIEF.missingArtifacts);
  assert.equal(input.plan?.steps.length, 4);
  assert.equal(gigProposalCliInput(reportFixtureGig({ brief: { ...REPORT_FIXTURE_BRIEF, language: "Deutsch" } }), null).language, "en", "a malformed code is English");
});

test("lockstep: the prompt version and the message cap match gig_proposal_cli.py", () => {
  assert.match(CLI, new RegExp(`^PROMPT_VERSION = "${GIG_PROPOSAL_PROMPT_VERSION}"$`, "m"));
  assert.match(CLI, new RegExp(`^MAX_MESSAGE_CHARS = ${GIG_PROPOSAL_MESSAGE_MAX}$`, "m"));
});
