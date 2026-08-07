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
import { htmlToMarkdown, markdownToHtml, safeLinkHref } from "./markdown-html.ts";

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

// ── Finding #3: literal markdown metacharacters are escaped, never re-parsed ──
// A recruiter types plain text into the editor; on read-back a literal `*`/`` ` ``
// must NOT become emphasis/code on the public JD page. Pre-fix htmlToMarkdown
// emitted the character verbatim (each assertion below FAILS against pre-fix code).

test("literal inline metacharacters are backslash-escaped on serialize (#3)", () => {
  assert.equal(htmlToMarkdown("<p>use *args and stuff</p>"), "use \\*args and stuff");
  assert.equal(htmlToMarkdown("<p>salary * negotiable</p>"), "salary \\* negotiable");
  assert.equal(htmlToMarkdown("<p>run `cmd` now</p>"), "run \\`cmd\\` now");
  // A literal <u>…</u> typed as text must not become an underline.
  assert.equal(htmlToMarkdown("<p>value &lt;u&gt;x&lt;/u&gt; here</p>"), "value \\<u>x\\</u> here");
});

test("escaped metacharacters render as literals and round-trip losslessly (#3)", () => {
  // The renderer unescapes: no <em>/<strong>/<code>, just the literal characters.
  assert.equal(markdownToHtml("2 \\* 3 = 6"), "<p>2 * 3 = 6</p>");
  assert.equal(markdownToHtml("a \\`b\\` c"), "<p>a `b` c</p>");
  // markdown → HTML → markdown is stable for escaped text.
  assert.equal(roundTrip("2 \\* 3 = 6"), "2 \\* 3 = 6");
  assert.equal(roundTrip("a \\* b"), "a \\* b");
  assert.equal(roundTrip("back \\\\ slash"), "back \\\\ slash");
  // Real emphasis is untouched by the new escape (regression guard).
  assert.equal(roundTrip("**bold** and *italic* and `code`"), "**bold** and *italic* and `code`");
});

test("a paragraph starting with a block marker is escaped, not turned into a list/heading (#3)", () => {
  assert.equal(htmlToMarkdown("<p>- not a bullet</p>"), "\\- not a bullet");
  assert.equal(htmlToMarkdown("<p># not a heading</p>"), "\\# not a heading");
  assert.equal(htmlToMarkdown("<div>3. not ordered</div>"), "3\\. not ordered");
  // …and those escaped lines render as plain paragraphs, not structure.
  assert.equal(markdownToHtml("\\- not a bullet"), "<p>- not a bullet</p>");
  assert.equal(markdownToHtml("\\# not a heading"), "<p># not a heading</p>");
  assert.equal(markdownToHtml("3\\. not ordered"), "<p>3. not ordered</p>");
  // Genuine structure still serializes with its real marker (regression guard).
  assert.equal(htmlToMarkdown("<ul><li>real bullet</li></ul>"), "- real bullet");
  assert.equal(htmlToMarkdown("<h2>Real heading</h2>"), "## Real heading");
});

// ── Finding #5: [text](url) links render, round-trip, and reject unsafe schemes ──

test("safeLinkHref allows only http/https/mailto", () => {
  assert.equal(safeLinkHref("https://x.com"), "https://x.com");
  assert.equal(safeLinkHref("  http://x.com "), "http://x.com");
  assert.equal(safeLinkHref("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(safeLinkHref("javascript:alert(1)"), null);
  assert.equal(safeLinkHref("data:text/html,x"), null);
  assert.equal(safeLinkHref("/relative/path"), null);
});

test("[text](url) renders a real <a> and round-trips (#5)", () => {
  assert.equal(
    markdownToHtml("[Apply here](https://careers.example.com)"),
    `<p><a href="https://careers.example.com" target="_blank" rel="noopener noreferrer">Apply here</a></p>`
  );
  // href with an ampersand survives the HTML escape and the round-trip.
  assert.equal(roundTrip("See [Apply](https://x.com/a?b=1&c=2) now"), "See [Apply](https://x.com/a?b=1&c=2) now");
  // An <a> seeded into the editor serializes back to markdown link syntax.
  assert.equal(htmlToMarkdown(`<p><a href="mailto:jobs@acme.com">email us</a></p>`), "[email us](mailto:jobs@acme.com)");
});

test("an unsafe-scheme link is rendered as inert text, never an href (#5)", () => {
  assert.equal(markdownToHtml("[x](javascript:alert(1))"), "<p>[x](javascript:alert(1))</p>");
  // A javascript: href stored via an <a> is dropped on serialize (link → plain text).
  assert.equal(htmlToMarkdown(`<p><a href="javascript:alert(1)">x</a></p>`), "x");
});
