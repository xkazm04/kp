// The generated check-deliverable.mjs (contract.ts): it runs as plain Node in a gig folder and
// its verdict agrees with kp's own validator (deliverable.ts) - an object it passes, sync
// accepts; the shapes the 2026-09-27 training cycle's agents actually wrote, it fails.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { GIG_DELIVERABLE_CHECKER_FILE, GIG_DELIVERABLE_FILE, gigDeliverableCheckerSource } from "./contract.ts";
import { validateGigDeliverable } from "./deliverable.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "kp-checker-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/** Run the checker in a fresh gig folder holding `fileText` as kp-deliverable.json. */
function check(fileText: string | null, files: string[] = []): { ok: boolean; out: string } {
  const dir = path.join(TMP, `gig-${++n}`);
  mkdirSync(path.join(dir, "deliverable"), { recursive: true });
  for (const f of files) writeFileSync(path.join(dir, f), "x");
  writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
  if (fileText !== null) writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), fileText);
  try {
    const out = execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as { stdout?: unknown }).stdout ?? "") };
  }
}

const GOOD = {
  version: 1,
  summary: "Built the proof.",
  draftText: "Proposal text.",
  artifacts: [{ kind: "file", ref: "deliverable/app.html", title: "Working demo" }],
  evidence: [{ kind: "test", command: "node --test", result: "6 pass", passed: true }],
  disclosure: "Prepared with AI assistance, reviewed by me.",
  confidence: 0.7,
  questions: [],
};

test("a contract-shaped object passes the checker AND kp's validator", () => {
  const r = check(JSON.stringify(GOOD), ["deliverable/app.html"]);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /^OK kp-deliverable\.json matches kp-deliverable\.v1 \(1 artifacts, 1 evidence, 0 questions\)/);
  assert.equal(validateGigDeliverable(GOOD).ok, true);
});

test("the shapes the training cycle's agents wrote fail, and kp's validator agrees", () => {
  // A designed persona's own "verdict" object (2026-09-27, booking app).
  const verdict = { version: "kp-deliverable.v1", gigId: "g", decision: "PURSUE", verdict: "SEND", draftText: "short", artifacts: [] };
  const r1 = check(JSON.stringify(verdict));
  assert.equal(r1.ok, false);
  assert.match(r1.out, /version must be the NUMBER 1/);
  assert.match(r1.out, /unknown key "decision"/);
  assert.match(r1.out, /disclosure must be a non-empty string/);
  assert.equal(validateGigDeliverable(verdict).ok, false);
  // Hand-written JSON with an unescaped quote inside a string (productivity e-book).
  const r2 = check('{"version": 1, "summary": "closes with a filled "Today\'s Plan" page"}');
  assert.equal(r2.ok, false);
  assert.match(r2.out, /is not valid JSON/);
  assert.match(r2.out, /JSON serializer/);
});

test("stricter than kp where it helps: a missing file artifact and a droppable row fail", () => {
  const missing = check(JSON.stringify(GOOD)); // deliverable/app.html not written
  assert.equal(missing.ok, false);
  assert.match(missing.out, /artifacts\[0\]\.ref "deliverable\/app\.html" does not exist/);
  const badRow = { ...GOOD, evidence: [{ kind: "vibes", result: "", passed: "yes" }] };
  const r = check(JSON.stringify(badRow), ["deliverable/app.html"]);
  assert.equal(r.ok, false);
  assert.match(r.out, /evidence\[0\]\.kind must be one of/);
  assert.match(r.out, /evidence\[0\]\.passed must be true, false or null/);
  assert.equal(validateGigDeliverable(badRow).ok, true, "kp would accept but silently drop the row - the checker makes the agent fix it");
});

test("internal notes in client-facing text fail; a client's own 'operator' and 'personas' pass", () => {
  const withText = (rel: string, text: string, over: Record<string, unknown> = {}) => {
    const dir = path.join(TMP, `gig-${++n}`);
    mkdirSync(path.join(dir, "deliverable", "docs"), { recursive: true });
    writeFileSync(path.join(dir, "deliverable/app.html"), "<p>app</p>");
    writeFileSync(path.join(dir, rel), text);
    writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
    // A folder artifact covers every file these cases write under deliverable/.
    const artifacts = [{ kind: "file", ref: "deliverable", title: "Proof" }];
    writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), JSON.stringify({ ...GOOD, artifacts, ...over }));
    try {
      return { ok: true, out: execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" }) };
    } catch (e) {
      return { ok: false, out: String((e as { stdout?: unknown }).stdout ?? "") };
    }
  };
  // The leaks the Hindi eBook review found (5q3cz5), nested one folder down.
  const comment = withText("deliverable/docs/ebook.html", "<h1>Ch 1</h1>\n<!-- OPERATOR: swap the cover before sending -->");
  assert.equal(comment.ok, false);
  assert.match(comment.out, /deliverable\/docs\/ebook\.html contains internal wording/);
  const section = withText("deliverable/proposal.md", "## Scope\nFive chapters.\n\n## Internal - do not send\nPrice floor $40.");
  assert.equal(section.ok, false);
  // Markdown emphasis before the label (8m1azy's template: "*OPERATOR NOTE: ...").
  const emphasised = withText("deliverable/template.md", "# Today's Plan\n*OPERATOR NOTE: export to .docx*\n");
  assert.equal(emphasised.ok, false, emphasised.out);
  // A disclosure written about us in the third person (myt1dp: "reviewed by the operator before sending").
  const prose = withText("deliverable/guide.md", "Prepared with AI assistance and reviewed by the operator before sending.\n");
  assert.equal(prose.ok, false, prose.out);
  // A placeholder for us inside a sentence (8u0q9o: "Reviewed and sent by [Operator Name].").
  const placeholder = withText("deliverable/proposal.md", "Prepared with AI assistance. Reviewed and sent by [Operator Name].\n");
  assert.equal(placeholder.ok, false, placeholder.out);
  // The disclosure field is pasted into what the client gets (5q3cz5 carried the third-person variant there).
  const disclosure = withText("deliverable/docs/readme.md", "fine", { disclosure: "Prepared with AI help and reviewed by the operator before sending." });
  assert.equal(disclosure.ok, false, disclosure.out);
  assert.match(disclosure.out, /disclosure contains internal wording/);
  // A third-person variant the marker scan cannot know every word for (gu5qvk: "the developer").
  const thirdPerson = withText("deliverable/docs/readme.md", "fine", { disclosure: "Prepared with AI assistance and reviewed by the developer." });
  assert.equal(thirdPerson.ok, false, thirdPerson.out);
  assert.match(thirdPerson.out, /disclosure must name AI assistance and say that you reviewed it, in the first person/);
  const draft = withText("deliverable/docs/readme.md", "fine", { draftText: "Hi! Note for the operator: attach the PDF." });
  assert.equal(draft.ok, false);
  assert.match(draft.out, /draftText contains internal wording/);
  // A client's own domain: none of these is ours.
  const clean = withText(
    "deliverable/docs/guide.md",
    "# Operators\nThe plant operator: logs each shift.\nThree buyer personas drive the funnel.\nMachine operators note the reading."
  );
  assert.ok(clean.ok, clean.out);
});

test("build clutter, this machine's home path, and a third-person footer in code fail", () => {
  const dir = path.join(TMP, `gig-${++n}`);
  mkdirSync(path.join(dir, "deliverable", "proof", ".venv"), { recursive: true });
  mkdirSync(path.join(dir, "deliverable", "proof", "__pycache__"), { recursive: true });
  mkdirSync(path.join(dir, "deliverable", ".git"), { recursive: true });
  writeFileSync(path.join(dir, "deliverable/app.html"), "<p>app</p>");
  writeFileSync(path.join(dir, "deliverable/proof/report.py"), 'FOOTER = "Generated with AI assistance, reviewed by the operator."\nops = {"operator": ">="}\n');
  writeFileSync(path.join(dir, "deliverable/proof/README.md"), `Run from ${path.join(homedir(), "gigs", "x")}\n`);
  writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
  writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), JSON.stringify(GOOD));
  let out = "";
  try {
    execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" });
    assert.fail("the checker passed a folder with clutter");
  } catch (e) {
    out = String((e as { stdout?: unknown }).stdout ?? "");
  }
  assert.match(out, /deliverable\/proof\/\.venv is build clutter/);
  assert.match(out, /deliverable\/proof\/__pycache__ is build clutter/);
  assert.doesNotMatch(out, /\.git is build clutter/, "a repository's .git is the client's, not clutter");
  assert.match(out, /deliverable\/proof\/report\.py contains internal wording "reviewed by the operator"/);
  assert.doesNotMatch(out, /"operator":/, "an `operator` key in code is not a note");
  assert.match(out, /deliverable\/proof\/README\.md contains this machine's home folder path/);
});

test("a file under deliverable/ that no artifact covers fails; a folder artifact covers its contents", () => {
  // 8a2yht shipped the uncorrected script.md beside its replacement script.txt.
  const stale = check(JSON.stringify(GOOD), ["deliverable/app.html", "deliverable/script.md", "deliverable/.gitkeep"]);
  assert.equal(stale.ok, false);
  assert.match(stale.out, /deliverable\/script\.md is in deliverable\/ but not in artifacts/);
  assert.doesNotMatch(stale.out, /\.gitkeep/);
  const dir = path.join(TMP, `gig-${++n}`);
  mkdirSync(path.join(dir, "deliverable", "proof", "src"), { recursive: true });
  writeFileSync(path.join(dir, "deliverable/proof/src/main.py"), "print('hi')\n");
  writeFileSync(path.join(dir, "deliverable/app.html"), "<p>app</p>");
  writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
  const folder = { ...GOOD, artifacts: [...GOOD.artifacts, { kind: "file", ref: "./deliverable/proof/", title: "Source" }] };
  writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), JSON.stringify(folder));
  const out = execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" });
  assert.match(out, /^OK /);
});

test("the AI disclosure inside the product (a page footer, generated output) fails; in a README it passes", () => {
  const dir = path.join(TMP, `gig-${++n}`);
  mkdirSync(path.join(dir, "deliverable"), { recursive: true });
  const sentence = "This work was prepared with the assistance of an AI agent and reviewed by me before sending.";
  writeFileSync(path.join(dir, "deliverable/index.html"), `<footer>${sentence}</footer>`);
  writeFileSync(path.join(dir, "deliverable/report.py"), `FOOTER = "${sentence}"\n`);
  writeFileSync(path.join(dir, "deliverable/README.md"), `${sentence}\n`);
  writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
  writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), JSON.stringify({ ...GOOD, artifacts: [{ kind: "file", ref: "deliverable", title: "Site" }] }));
  let out = "";
  try {
    execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" });
    assert.fail("the checker passed a disclosure inside the product");
  } catch (e) {
    out = String((e as { stdout?: unknown }).stdout ?? "");
  }
  assert.match(out, /deliverable\/index\.html carries the AI disclosure/);
  assert.match(out, /deliverable\/report\.py carries the AI disclosure/);
  assert.doesNotMatch(out, /README\.md carries/);
});

test("no file at all says so", () => {
  const r = check(null);
  assert.equal(r.ok, false);
  assert.match(r.out, /kp-deliverable\.json is missing/);
});
