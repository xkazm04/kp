import { Fragment, type ReactNode } from "react";
import { PlantUml } from "./puml/PlantUml";
import { safeLinkHref } from "./markdown-html";

// A small, dependency-free Markdown renderer for the subset job postings need:
// # / ## / ### headings, - / * bullet and 1. ordered lists, --- rules, blank-line
// paragraphs, inline **bold** / *italic* / `code` / `[text](url)` links / <u>, and
// backslash escapes (`\*` prints a literal `*`). It builds React elements (never
// dangerouslySetInnerHTML), so input text — including link hrefs — is rendered safely.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // A `\`-escape wins first (so `\*` prints a literal `*`), then `[text](url)`, then
  // the FIRST of **bold**, *italic*, `code`, <u> left to right — bold before italic so
  // `**` wins over `*`, and a non-greedy `[\s\S]+?` lets an emphasis span CONTAIN other
  // markers. Bold/italic/link-text recurse so nested emphasis renders; code is literal.
  // Still builds React elements, never dangerouslySetInnerHTML.
  // Groups: 1 escaped char · 2 link text · 3 link url · 4 bold · 5 italic · 6 code · 7 underline.
  const re = /\\([\\*`<#.-])|\[([^\]]+)\]\(([^)]+)\)|\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|`([^`]+)`|<u>([\s\S]*?)<\/u>/;
  let rest = text;
  let n = 0;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out.push(<Fragment key={`${keyBase}-t${n++}`}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0) out.push(<Fragment key={`${keyBase}-t${n++}`}>{rest.slice(0, m.index)}</Fragment>);
    if (m[1] !== undefined) {
      // Escaped literal — emit the character itself, stripped of its backslash.
      out.push(<Fragment key={`${keyBase}-e${n++}`}>{m[1]}</Fragment>);
      rest = rest.slice(m.index + m[0].length);
      continue;
    }
    const key = `${keyBase}-m${n++}`;
    if (m[2] !== undefined) {
      // [text](url) — a real <a> when the scheme is safe (http/https/mailto), else the
      // raw syntax as inert text. href is a prop (never dangerouslySetInnerHTML).
      const href = safeLinkHref(m[3]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral">
            {inline(m[2], key)}
          </a>
        ) : (
          <Fragment key={key}>{m[0]}</Fragment>
        )
      );
    } else if (m[4] !== undefined) out.push(<strong key={key} className="font-semibold text-ink">{inline(m[4], key)}</strong>);
    else if (m[5] !== undefined) out.push(<em key={key}>{inline(m[5], key)}</em>);
    // <u>…</u> — the one HTML tag the RichTextEditor round-trips (markdown has no
    // native underline); rendered as a real <u>, still React elements (safe).
    else if (m[7] !== undefined) out.push(<u key={key}>{inline(m[7], key)}</u>);
    else out.push(<code key={key} className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">{m[6]}</code>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function Markdown({ content, className = "" }: { content: string; className?: string }) {
  const lines = (content ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }
    // Fenced code block: ```lang … ```. A `puml`/`plantuml` fence renders as a
    // custom-styled component diagram; anything else falls back to a <pre>.
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence
      const code = body.join("\n");
      if (lang === "puml" || lang === "plantuml") {
        blocks.push(<PlantUml key={key++} source={code} />);
      } else {
        blocks.push(
          <pre
            key={key++}
            className="my-3 overflow-x-auto rounded-lg border border-stone-200 bg-paper p-4 text-[13px] leading-5 text-ink"
          >
            <code>{code}</code>
          </pre>
        );
      }
      continue;
    }
    if (trimmed === "---" || trimmed === "***") {
      blocks.push(<hr key={key++} className="my-4 border-stone-200" />);
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? "font-serif text-h2 text-ink mt-4 first:mt-0" : level === 2 ? "font-serif text-h3 text-ink mt-4" : "text-base font-semibold text-ink mt-3";
      const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
      blocks.push(<Tag key={key++} className={cls}>{inline(heading[2], `h${key}`)}</Tag>);
      i += 1;
      continue;
    }
    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="mt-2 list-disc space-y-1 pl-5 text-base text-ink">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `ul${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }
    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="mt-2 list-decimal space-y-1 pl-5 text-base text-ink">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `ol${key}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }
    // Paragraph (join consecutive non-blank, non-structural lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      lines[i].trim() !== "---"
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="mt-2 text-base leading-7 text-ink first:mt-0">
        {inline(para.join(" "), `p${key}`)}
      </p>
    );
  }

  return <div className={className}>{blocks}</div>;
}
