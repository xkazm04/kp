"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { briefDraftHasContent, briefDraftMarkdown } from "@/app/_lib/intake-draft";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { diffDraft } from "../../intakeDelta";
import { AtelierGhost } from "./atelierPlane";

// ATELIER — the JD draft as a TYPESET SHEET.
//
// The classic pane renders the same markdown, and the difference is entirely
// typographic: a reading measure (the posting stops at ~38rem rather than
// running the full width of a zone), the display face on every heading, and a
// vertical rhythm that is the document's rather than the leaf's. It reads as a
// page someone will publish, which is what it is, instead of as the third panel
// of a tool.
//
// WHAT MOVED, NOT "SOMETHING MOVED" — kept verbatim from the shipped pane,
// because it is a correctness property and not a coat decision: the document is
// split at its blank lines into the blocks markdown already separates, each is
// matched against the previous render by `diffDraft`, and only a block holding a
// new or replaced line flashes. An untouched block keeps its element and does
// not animate at all. `previous === null` is the first document this sheet ever
// drew and nothing on it is news, so opening a finished session is still.

type DraftBlock = { text: string; from: number; to: number };

function toBlocks(lines: readonly string[]): DraftBlock[] {
  const out: DraftBlock[] = [];
  let start = -1;
  lines.forEach((line, i) => {
    if (line.trim() === "") {
      if (start >= 0) out.push({ text: lines.slice(start, i).join("\n"), from: start, to: i - 1 });
      start = -1;
    } else if (start < 0) start = i;
  });
  if (start >= 0) out.push({ text: lines.slice(start).join("\n"), from: start, to: lines.length - 1 });
  return out;
}

function draftState(md: string, previous: string[] | null) {
  const lines = md.split("\n");
  const moved = previous === null ? { added: [], changed: [] } : diffDraft(previous, lines);
  const hot = new Set([...moved.added, ...moved.changed]);
  const blocks = toBlocks(lines).map((block) => ({
    ...block,
    moved: [...hot].some((i) => i >= block.from && i <= block.to),
  }));
  return { md, lines, blocks };
}

/** The sheet's typography, applied once to the whole page rather than fought for
 *  per block: display face on the headings, a reading leading on the prose, a
 *  measure the eye can return from. */
const SHEET =
  "max-w-[38rem] [&_h1]:font-serif [&_h1]:text-h2 [&_h2]:font-serif [&_h2]:text-h3 [&_h3]:font-serif [&_p]:leading-7 [&_li]:leading-7";

export function AtelierDraftSheet({ brief }: { brief: RoleBrief | null }) {
  const t = useTranslations("library.tab.intake.draft");
  const md = useMemo(
    () =>
      briefDraftMarkdown(brief, {
        untitled: t("untitled"),
        level: (seniority) => t("level", { seniority }),
        aboutRole: t("aboutRole"),
        outcomes: t("outcomes"),
        responsibilities: t("responsibilities"),
        whatBring: t("whatBring"),
        niceToHave: t("niceToHave"),
        languages: t("languages"),
      }),
    [brief, t]
  );
  // React's own adjust-state-when-a-prop-changes pattern, never a ref read
  // during render: keyed on `md`, so this recomputes exactly once per new
  // document and carries the answer through the render that asked for it.
  const [seen, setSeen] = useState(() => draftState(md, null));
  let current = seen;
  if (seen.md !== md) {
    current = draftState(md, seen.lines);
    setSeen(current);
  }

  // An empty sheet shows the SHAPE of a posting — a heading rule and the lines
  // under it — never a sentence promising that one will appear.
  if (!briefDraftHasContent(brief)) return <AtelierGhost rows={6} gutter={false} />;

  return (
    <div className={SHEET}>
      {current.blocks.map((block, i) => (
        <Markdown
          key={`${block.from}:${block.text}`}
          content={block.text}
          className={`${i > 0 ? "mt-3" : ""}${block.moved ? " animate-arrive-in" : ""}`}
        />
      ))}
    </div>
  );
}
