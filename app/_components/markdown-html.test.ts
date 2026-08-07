// Round-trip contract for the RichTextEditor's markdown ⇄ HTML bridge. The editor
// seeds a contentEditable from markdownToHtml(value) and reads it back with
// htmlToMarkdown(el.innerHTML); if that round-trip weren't stable, opening and
// saving a template (or the "Describe the need" body) unedited would corrupt it —
// especially the {{placeholders}} the template pipeline depends on.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, markdownToHtml } from "./markdown-html.ts";

// markdown → HTML → markdown; the second pass must equal the first (idempotent).
const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md));

test("headings map to # / ## / ###", () => {
  assert.equal(roundTrip("# Title"), "# Title");
  assert.equal(roundTrip("## Section"), "## Section");
  assert.equal(roundTrip("### Sub"), "### Sub");
});

test("bullet and ordered lists preserve their items", () => {
  assert.equal(roundTrip("- one\n- two\n- three"), "- one\n- two\n- three");
  assert.equal(roundTrip("1. first\n2. second"), "1. first\n2. second");
  // A `*` bullet normalizes to `-` (both render identically).
  assert.equal(roundTrip("* a\n* b"), "- a\n- b");
});

test("inline bold / italic / code / underline survive", () => {
  assert.equal(roundTrip("**bold** and *italic*"), "**bold** and *italic*");
  assert.equal(roundTrip("use `code` here"), "use `code` here");
  assert.equal(roundTrip("<u>underlined</u> text"), "<u>underlined</u> text");
  assert.equal(roundTrip("a **bold *nested* word**"), "a **bold *nested* word**");
});

test("paragraphs are separated by a blank line", () => {
  assert.equal(roundTrip("First paragraph.\n\nSecond paragraph."), "First paragraph.\n\nSecond paragraph.");
});

test("template {{placeholders}} pass through untouched", () => {
  const tpl = "## {{title}} at {{company}}\n- {{seniority}} role\n- Salary: {{salary}}";
  assert.equal(roundTrip(tpl), tpl);
});

test("a heading attaches to its next block with a single newline", () => {
  // render-template.ts reads "heading then a BLANK line" as an empty section to
  // drop; a heading must stay glued to its content across a round-trip so a filled
  // section survives. (Non-heading blocks still separate with a blank line.)
  assert.equal(roundTrip("## Section\n\nBody text"), "## Section\nBody text");
  assert.equal(roundTrip("# Title\n\n- one\n- two"), "# Title\n- one\n- two");
});

test("a mixed document round-trips", () => {
  const md = ["# Backend Engineer", "We need someone strong in **Go** and *Kubernetes*.", "", "## Responsibilities", "- Ship services", "- Own <u>reliability</u>"].join("\n");
  assert.equal(roundTrip(md), md);
});

test("HTML from a contentEditable edit serializes to clean markdown", () => {
  // Shapes Chromium emits: <div> lines, <b>/<i>/<u>, nested list, &nbsp;.
  assert.equal(htmlToMarkdown("<div>Hello <b>world</b></div><div>Next line</div>"), "Hello **world**\n\nNext line");
  assert.equal(htmlToMarkdown("<b>bold</b> and <i>italic</i> and <u>under</u>"), "**bold** and *italic* and <u>under</u>");
  assert.equal(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>"), "- a\n- b");
  assert.equal(htmlToMarkdown("first&nbsp;line"), "first line");
  // Empty blocks / stray whitespace are dropped, not turned into blank paragraphs.
  assert.equal(htmlToMarkdown("<p>text</p><div><br></div>"), "text");
});

test("HTML entities decode; markdown special chars in text are preserved", () => {
  assert.equal(htmlToMarkdown("<p>Tom &amp; Jerry &lt;3</p>"), "Tom & Jerry <3");
  // & and < survive the markdown→html escape and come back intact.
  assert.equal(roundTrip("Ben & Co. values > 90%"), "Ben & Co. values > 90%");
});

test("empty / whitespace input yields empty markdown", () => {
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(markdownToHtml(""), "");
  assert.equal(roundTrip("   \n\n  "), "");
});
