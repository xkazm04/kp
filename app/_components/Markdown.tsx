import { Fragment, type ReactNode } from "react";
import { PlantUml } from "./puml/PlantUml";

// A small, dependency-free Markdown renderer for the subset job postings need:
// # / ## / ### headings, - / * bullet and 1. ordered lists, --- rules, blank-line
// paragraphs, and inline **bold** / *italic* / `code`. It builds React elements
// (never dangerouslySetInnerHTML), so input text is rendered safely.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Match the FIRST of **bold**, *italic*, `code` left to right — bold listed before italic
  // so `**` wins over `*`, and a non-greedy `[\s\S]+?` lets an emphasis span CONTAIN other
  // markers. The old `[^*]+` dropped any bold/italic that contained a `*` (rendering the raw
  // asterisks). Bold and italic recurse into their content so nested emphasis renders; code
  // is literal (no recursion). Still builds React elements, never dangerouslySetInnerHTML.
  const re = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|`([^`]+)`/;
  let rest = text;
  let n = 0;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out.push(<Fragment key={`${keyBase}-t${n++}`}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0) out.push(<Fragment key={`${keyBase}-t${n++}`}>{rest.slice(0, m.index)}</Fragment>);
    const key = `${keyBase}-m${n++}`;
    if (m[1] !== undefined) out.push(<strong key={key} className="font-semibold text-ink">{inline(m[1], key)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key}>{inline(m[2], key)}</em>);
    else out.push(<code key={key} className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">{m[3]}</code>);
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
