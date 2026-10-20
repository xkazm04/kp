// ---------------------------------------------------------------------------
// The summary, set for reading
// ---------------------------------------------------------------------------

/** Markdown structure the deliverable contract asks the summary to carry: a list line, a
 *  heading, a bold run. A summary that has any of it is rendered as the agent wrote it. */
const MARKDOWN_SHAPE = /(^|\n)\s*([-*•]\s|\d+[.)]\s|#{1,4}\s)|\*\*[^*]+\*\*/;

/** A sentence ends at . ! or ? followed by whitespace and a capital, a digit or an opening
 *  bracket/quote - so "demo.html", "0.998" and "v1.2" never split. */
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9(“"'])/;

/** The deliverable's summary as Markdown the desk can set. The contract asks for a lead
 *  sentence and bullets; a summary written before that (one long paragraph) is set the same
 *  way deterministically: its first sentence as the lead, every following sentence a bullet.
 *  Two sentences or fewer stay one paragraph. Nothing is reworded or dropped. */
export function summaryMarkdown(text: string): string {
  const s = text.trim();
  if (!s || MARKDOWN_SHAPE.test(s)) return s;
  const sentences = s.split(SENTENCE_END).map((x) => x.trim()).filter(Boolean);
  if (sentences.length <= 2) return s;
  return [sentences[0], "", ...sentences.slice(1).map((x) => `- ${x}`)].join("\n");
}

/** The body of the brief's first `## ` section ("What the gig is"): what a gig with no draft
 *  yet leads with. Null when the brief has no such section or it is empty. */
export function firstBriefSection(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const lines = markdown.split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+/.test(l));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^##\s+/.test(l));
  const body = lines.slice(at + 1, end < 0 ? undefined : end).join("\n").trim();
  return body || null;
}

export type SummaryText = { kind: "summary" | "about" | "listing"; text: string };

/** What the proof's Summary tab reads: the deliverable's summary set as Markdown, else the
 *  brief's "What the gig is", else the listing as written (a stranger's text: never
 *  Markdown, and never cut short - the tab shows all of it). */
export function summaryTextOf(summary: string | null | undefined, briefMarkdown: string | null | undefined, listing: string): SummaryText {
  const s = summary?.trim();
  if (s) return { kind: "summary", text: summaryMarkdown(s) };
  const about = firstBriefSection(briefMarkdown);
  if (about) return { kind: "about", text: about };
  return { kind: "listing", text: listing };
}
