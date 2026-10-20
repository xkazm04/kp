import type { ReactNode } from "react";

// A chapter's opening, shared by every step of the flow (sieve.css "chapters").
//
// The flow reads as one story told in eight chapters, the way the landing and /about read:
// a large outlined numeral set behind the head (decoration, hidden from assistive tech -
// the eyebrow already says "Step 4"), the eyebrow in the landing's hand-written voice, the
// title at display scale, and an optional lede and aside (a Scan now door, a margin note).
// The numeral and the title rise in as the chapter scrolls into view (CSS scroll-driven,
// gated on prefers-reduced-motion) - no script, so an unsupporting browser simply shows
// the finished head.
//
// `level` 1 is the page's one h1 (Arrive, before a CV is in); every other chapter is h2.

export function ChapterHead({
  n,
  id,
  eyebrow,
  title,
  lede,
  sub,
  aside,
  level = 2,
}: {
  n: number;
  /** The heading's id, which the section names as aria-labelledby. */
  id: string;
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** Rich content under the title (chips, a meta row) - a block, where `lede` is prose. */
  sub?: ReactNode;
  aside?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="chapter">
      <span className="chapter-n" aria-hidden>
        {String(n).padStart(2, "0")}
      </span>
      <div className="chapter-copy">
        <p className="eyebrow">{eyebrow}</p>
        <Heading id={id}>{title}</Heading>
        {lede ? <p className="lede">{lede}</p> : null}
        {sub ? <div className="chapter-sub">{sub}</div> : null}
      </div>
      {aside ? <div className="chapter-aside">{aside}</div> : null}
    </header>
  );
}
