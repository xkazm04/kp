// The gig report's pure layers: the allow-list sanitizer, the page template, the facts and
// their stage, kp's deterministic body per stage, the model-answer validator and the section
// fill, the file placement and its atomic write - plus the lockstep with gig_report_cli.py
// (prompt version, section kinds, stage plan). No DB, no model, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportFixtureInput } from "../__fixtures__/report-facts.ts";
import { GIG_REPORT_STAGES, type GigReportStage } from "../types.ts";
import { assembleGigReport, fillRequiredSections, parseGigReportBody } from "./assemble.ts";
import { deterministicReportBody, briefMarkdownHtml } from "./deterministic.ts";
import { buildGigReportFacts, gigReportStageOf } from "./facts.ts";
import { gigReportPathFor, gigReportsRoot, previousReportPath, writeGigReportFile } from "./file.ts";
import { GIG_REPORT_CSP, readGigReportFile, servedReportsRoot } from "./serve.ts";
import { GIG_REPORT_SECTION_KINDS, sectionPlanFor } from "./model.ts";
import { GIG_REPORT_CSS } from "./report-css.ts";
import { GIG_REPORT_PROMPT_VERSION } from "./run.ts";
import { sanitizeReportHtml, safeHttpsHref } from "./sanitize.ts";
import { railHtml, renderGigReportPage } from "./template.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CLI = readFileSync(path.join(REPO, "pipeline", "jobfit", "gig_report_cli.py"), "utf8");

function facts(stage: GigReportStage) {
  const f = buildGigReportFacts(reportFixtureInput(stage));
  assert.ok(f, `facts for ${stage}`);
  return f;
}

// ---------------------------------------------------------------------------
// The sanitizer
// ---------------------------------------------------------------------------

test("sanitize: scripts, styles, iframes, images and svg go WITH their content", () => {
  const out = sanitizeReportHtml(
    `<p>ok</p><script>alert(1)</script><style>p{}</style><iframe src="https://x.test"></iframe><img src=x onerror=alert(1)><svg><script>x</script><text>t</text></svg><math>m</math><template><p>t</p></template>`
  );
  assert.equal(out, "<p>ok</p>");
});

test("sanitize: every attribute but class / colspan / rowspan / an https href is dropped", () => {
  const out = sanitizeReportHtml(`<p onclick="x()" style="color:red" id="a" data-x="1">t</p><td colspan="2" rowspan="99" onmouseover="x">c</td>`);
  assert.doesNotMatch(out, /onclick|style=|id=|data-x|onmouseover|rowspan/);
  assert.match(out, /<p>t<\/p>/);
  assert.match(out, /colspan="2"/);
});

test("sanitize: classes are filtered to the element's vocabulary; an unclassed div/span is unwrapped", () => {
  const out = sanitizeReportHtml(
    `<div class="stat-cards evil"><div class="stat"><span class="n">$1</span><span class="l">L</span><span class="c x">C</span></div></div><div class="callout warn danger">w</div><span class="pill ok big">p</span><div>plain</div><span class="nope">s</span><p class="stat">no class on p</p>`
  );
  assert.match(out, /<div class="stat-cards"><div class="stat"><span class="n">\$1<\/span><span class="l">L<\/span><span class="c">C<\/span><\/div><\/div>/);
  assert.match(out, /<div class="callout warn">w<\/div>/);
  assert.match(out, /<span class="pill ok">p<\/span>/);
  assert.match(out, /plain/);
  assert.doesNotMatch(out, /<div>plain|class="nope"|<p class/);
});

test("sanitize: javascript:, data:, http: and relative hrefs are unwrapped; https keeps a kp rel", () => {
  const out = sanitizeReportHtml(`<a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a><a href="http://x.test">c</a><a href="/x">d</a><a href="https://u:p@x.test">e</a><a href="https://ok.test/?a=1&b=2" target="_top">f</a>`);
  assert.equal(out, `abcde<a href="https://ok.test/?a=1&amp;b=2" rel="noopener noreferrer nofollow">f</a>`);
  assert.equal(safeHttpsHref(" JaVaScRiPt:alert(1)"), null);
});

test("sanitize: headings fold to h3, b/i to strong/em, text is re-escaped, tables get kp's scroll wrapper", () => {
  const out = sanitizeReportHtml(`<h1>A</h1><h2>B</h2><h4>C</h4><b>b</b><i>i</i>&lt;script&gt; &amp; "q" <table><tr><td>1</td></tr></table>`);
  assert.match(out, /^<h3>A<\/h3><h3>B<\/h3><h3>C<\/h3><strong>b<\/strong><em>i<\/em>&lt;script&gt; &amp; &quot;q&quot; <div class="tbl"><table>/);
  // The wrapper class is kp's: a model cannot write it.
  assert.doesNotMatch(sanitizeReportHtml(`<div class="tbl">x</div>`), /class="tbl"/);
});

test("sanitize: nesting is always closed, a stray </body> loses nothing, deep nesting flattens to text", () => {
  assert.equal(sanitizeReportHtml(`<p>a <em>b <strong>c</p>`), "<p>a <em>b <strong>c</strong></em></p>");
  assert.match(sanitizeReportHtml(`<p>one</p></body></html><p>two</p>`), /<p>two<\/p>/);
  const deep = "<ul><li>".repeat(40) + "deep" + "</li></ul>".repeat(40);
  const out = sanitizeReportHtml(deep);
  assert.match(out, /deep/);
  assert.ok((out.match(/<ul>/g) ?? []).length <= 24);
});

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

test("template: the rail is generated from the sections, numbered in page order and grouped by topic", () => {
  const rail = railHtml([
    { id: "s-gig", title: "The gig", kind: "gig", html: "" },
    { id: "s-plans", title: "Plans", kind: "plans", html: "" },
    { id: "s-fit", title: "Money", kind: "fit", html: "" },
  ]);
  assert.match(rail, /<h2>The gig<\/h2><a href="#s-gig"><b>1<\/b>The gig<\/a><a href="#s-fit"><b>3<\/b>Money<\/a><h2>The plan<\/h2><a href="#s-plans"><b>2<\/b>Plans<\/a>/);
  assert.doesNotMatch(rail, /The work|The result/);
});

test("template: one self-contained document - dark mode, print, no script, no external request", () => {
  const html = assembleGigReport({ facts: facts("drafted"), modelResult: null, model: null, fallbackReason: "no_provider", costUsd: null, generatedAt: "2026-09-30T09:00:00.000Z" }).html;
  assert.match(GIG_REPORT_CSS, /@media \(prefers-color-scheme: dark\)/);
  assert.match(GIG_REPORT_CSS, /@media print/);
  assert.doesNotMatch(GIG_REPORT_CSS, /url\(|@import|https?:\/\//);
  assert.doesNotMatch(html, /<script|<link|<img|@import|url\(/i);
  // Only kp's own links leave the page: the listing, and nothing a model wrote.
  for (const m of html.matchAll(/href="([^"#][^"]*)"/g)) assert.match(m[1], /^https:\/\//);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /aria-current="step">Drafted</);
  assert.match(html, /class="kicker">Freelance · Web · Drafted</);
});

test("template: every interpolated fact is escaped", () => {
  const html = renderGigReportPage({
    title: `<script>x</script>`,
    railTitle: `"><img>`,
    railSub: "s",
    eyebrow: ["<b>"],
    lead: "lead <i>",
    highlight: "<i>",
    meta: ["<m>"],
    listingUrl: "javascript:alert(1)",
    stage: "researched",
    stats: [{ n: "<n>", l: "<l>", c: "<c>" }],
    sections: [{ id: `x"y`, title: "<t>", kind: "gig", html: "<p>trusted</p>" }],
    provenance: { source: "llm", model: "<m>", fallbackReason: null, costUsd: 0.1234, generatedAt: "g", factsAt: "f", filled: [] },
  });
  assert.doesNotMatch(html, /<script>x|<img>|<m>|<n>|<l>|<c>|<t>|javascript:|lead <i>/);
  assert.match(html, /class="kicker">&lt;b&gt;</);
  assert.match(html, /<p>trusted<\/p>/);
  assert.match(html, /<mark>&lt;i&gt;<\/mark>/);
  assert.match(html, /Cost: \$0\.12/);
});

// ---------------------------------------------------------------------------
// Facts, stages and kp's deterministic body
// ---------------------------------------------------------------------------

test("facts: the stage follows the records, and there is no report without a brief", () => {
  for (const stage of GIG_REPORT_STAGES) assert.equal(facts(stage).stage, stage);
  const input = reportFixtureInput("researched");
  assert.equal(gigReportStageOf({ ...input, gig: { ...input.gig, brief: null } }), null);
  assert.equal(gigReportStageOf({ ...input, gig: { ...input.gig, status: "withdrawn" } }), "closed");
});

test("facts: kp does the money arithmetic, and an unreported cost is counted, never summed as zero", () => {
  const f = facts("drafted");
  assert.equal(f.money.rewardUsd, 2106);
  assert.equal(f.money.rewardUsdIsEstimate, true);
  // The accepted plan's 18-30 h: 2106/30 = 70, 2106/18 = 117.
  assert.deepEqual(f.money.ratePerHourUsd, { min: 70, max: 117 });
  // Plans: 0.61 reported, the Fable and failed GPT seats not; the run: 2.40.
  assert.deepEqual(f.money.spentUsd, { plans: 0.61, agentRuns: 2.4, total: 3.01 });
  assert.equal(f.money.unreported, 2);
  assert.ok(f.lint.some((l) => l.severity === "blocker" && /Evidence 2 \(test\) failed/.test(l.text)));
});

test("deterministic body: every stage carries exactly its section plan, in order, with no model prose", () => {
  for (const stage of GIG_REPORT_STAGES) {
    const body = deterministicReportBody(facts(stage));
    assert.deepEqual(body.sections.map((s) => s.kind), sectionPlanFor(stage), stage);
    for (const s of body.sections) assert.ok(s.html.length > 0, `${stage}/${s.kind} is empty`);
  }
  const drafted = deterministicReportBody(facts("drafted"));
  const evidence = drafted.sections.find((s) => s.kind === "evidence")!.html;
  assert.match(evidence, /class="pill ok">passed/);
  assert.match(evidence, /class="pill fail">failed/);
  assert.match(evidence, /class="pill wait">ran/);
  const closed = deterministicReportBody(facts("closed"));
  assert.match(closed.sections.find((s) => s.kind === "outcome")!.html, /Not reported|not reported/);
  assert.deepEqual(sectionPlanFor("closed"), [...sectionPlanFor("sent"), "lessons"]);
});

test("deterministic body: the brief's Markdown is read small and escaped", () => {
  assert.equal(briefMarkdownHtml("## A <b>\n- one `x`\n- **two**\n\npara"), "<h3>A &lt;b&gt;</h3><ul><li>one <code>x</code></li><li><strong>two</strong></li></ul><p>para</p>");
});

// ---------------------------------------------------------------------------
// The model's answer
// ---------------------------------------------------------------------------

const MODEL = {
  lead: "Take it: the reward pays about $70-117 an hour.",
  highlight: "about $70-117 an hour",
  sections: [
    { id: "gig", title: "The gig", kind: "gig", html: "<p>A gig.</p><script>x</script>" },
    { id: "gig", title: "Again", kind: "gig", html: "<p>Twice.</p>" },
    { id: "odd", title: "Odd", kind: "nonsense", html: "<p onclick=x>Odd.</p>" },
    { id: "empty", title: "Empty", kind: "fit", html: "<p> </p><img src=x>" },
    { id: "risks", title: "<b>Risks</b>", kind: "risks", html: "<table><tr><td>r</td></tr></table>" },
  ],
};

test("parse: sections are sanitized, ids re-minted unique, unknown kinds become other, empty ones dropped", () => {
  const body = parseGigReportBody(MODEL);
  assert.ok(body);
  assert.deepEqual(body.sections.map((s) => [s.id, s.kind, s.title]), [["s-gig", "gig", "The gig"], ["s-gig-2", "gig", "Again"], ["s-odd", "other", "Odd"], ["s-risks", "risks", "Risks"]]);
  assert.equal(body.sections[0].html, "<p>A gig.</p>");
  assert.equal(body.highlight, "about $70-117 an hour");
  assert.equal(parseGigReportBody({ ...MODEL, highlight: "not in the lead" })?.highlight, null);
  assert.equal(parseGigReportBody({ ...MODEL, lead: " " }), null);
  assert.equal(parseGigReportBody({ ...MODEL, sections: MODEL.sections.slice(3) }), null, "fewer than three usable sections");
  assert.equal(parseGigReportBody("nope"), null);
});

test("assemble: a section the stage requires and the model left out is kp's, in plan order, named in the footer", () => {
  const f = facts("planned");
  const { body, filled } = fillRequiredSections(f, parseGigReportBody(MODEL)!);
  assert.deepEqual(filled, ["asks", "fit", "questions", "plans"]);
  assert.deepEqual(body.sections.map((s) => s.kind), ["gig", "gig", "asks", "other", "risks", "fit", "questions", "plans"]);
  const a = assembleGigReport({ facts: f, modelResult: MODEL, model: "claude-sonnet-5-5", fallbackReason: null, costUsd: 0.19, generatedAt: "2026-09-30T09:00:00.000Z" });
  assert.equal(a.source, "llm");
  assert.match(a.html, /kp wrote these sections itself/);
  assert.match(a.html, /<mark>about \$70-117 an hour<\/mark>/);
  assert.match(a.html, /claude-sonnet-5-5/);
});

test("assemble: keyless and unusable answers are kp's body, and say why", () => {
  const f = facts("researched");
  const keyless = assembleGigReport({ facts: f, modelResult: null, model: null, fallbackReason: "no_provider", costUsd: null, generatedAt: "g" });
  assert.equal(keyless.source, "deterministic");
  assert.equal(keyless.fallbackReason, "no_provider");
  assert.match(keyless.html, /Written by kp from its own facts, with no model \(<code>no_provider<\/code>\)/);
  const unusable = assembleGigReport({ facts: f, modelResult: { lead: "x" }, model: "m", fallbackReason: null, costUsd: 0.05, generatedAt: "g" });
  assert.equal(unusable.fallbackReason, "llm_unusable");
});

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

test("file: <reports root>/<type>/<date>-<slug>-<id6>.html; a recorded path under the root is kept", () => {
  const root = path.resolve("/tmp/gigs/_reports");
  const gig = reportFixtureInput("researched").gig;
  assert.equal(gigReportPathFor(root, gig), path.join(root, "web", "2026-09-28-checkout-page-too-slow-next-js-a1b2c3.html"));
  const kept = path.join(root, "other", "old-name.html");
  assert.equal(gigReportPathFor(root, { ...gig, report: { path: kept } }), kept);
  assert.equal(gigReportPathFor(root, { ...gig, report: { path: path.resolve("/etc/passwd.html") } }), path.join(root, "web", "2026-09-28-checkout-page-too-slow-next-js-a1b2c3.html"));
  assert.equal(previousReportPath(path.join(root, "a.html")), path.join(root, "a.prev.html"));
});

test("file: an atomic write keeps the previous version as .prev.html and leaves no temp file; reads stay under the root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kp-report-"));
  try {
    const file = path.join(root, "web", "a.html");
    writeGigReportFile(file, "one");
    assert.equal(readFileSync(file, "utf8"), "one");
    assert.equal(existsSync(previousReportPath(file)), false);
    writeGigReportFile(file, "two");
    assert.equal(readFileSync(file, "utf8"), "two");
    assert.equal(readFileSync(previousReportPath(file), "utf8"), "one");
    assert.deepEqual(readdirSync(path.join(root, "web")).sort(), ["a.html", "a.prev.html"]);
    assert.equal(readGigReportFile(root, file), "two");
    const outside = path.join(tmpdir(), `kp-outside-${process.pid}.html`);
    writeFileSync(outside, "secret");
    assert.equal(readGigReportFile(root, outside), null);
    rmSync(outside, { force: true });
    assert.equal(readGigReportFile(root, path.join(root, "web", "missing.html")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.match(GIG_REPORT_CSP, /^sandbox; default-src 'none'/);
});

test("serve: the route's leaf resolves the same reports root as the writer", () => {
  for (const env of [{}, { KP_GIGS_ROOT: "D:/work/gigs" }, { KP_GIGS_ROOT: "  ../elsewhere " }, { KP_GIGS_ROOT: "" }]) {
    assert.equal(servedReportsRoot(env, "/repo/kp"), gigReportsRoot({ env, repoRoot: "/repo/kp" }), JSON.stringify(env));
  }
});

// ---------------------------------------------------------------------------
// Lockstep with gig_report_cli.py
// ---------------------------------------------------------------------------

test("lockstep: the prompt version, the section kinds and the stage plan match gig_report_cli.py", () => {
  assert.match(CLI, new RegExp(`^PROMPT_VERSION = "${GIG_REPORT_PROMPT_VERSION}"$`, "m"));
  const kinds = CLI.slice(CLI.indexOf("SECTION_KINDS = ("), CLI.indexOf(")", CLI.indexOf("SECTION_KINDS = (")));
  assert.deepEqual([...kinds.matchAll(/"([a-z]+)"/g)].map((m) => m[1]), [...GIG_REPORT_SECTION_KINDS]);
  for (const stage of GIG_REPORT_STAGES) {
    const adds = new RegExp(`"${stage}": \\(([^)]*)\\)`).exec(CLI);
    assert.ok(adds, stage);
    const prev = GIG_REPORT_STAGES.indexOf(stage) === 0 ? [] : sectionPlanFor(GIG_REPORT_STAGES[GIG_REPORT_STAGES.indexOf(stage) - 1]);
    assert.deepEqual([...adds[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]), sectionPlanFor(stage).slice(prev.length), stage);
  }
});
