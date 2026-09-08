"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
import { briefDraftHasContent, briefDraftMarkdown } from "@/app/_lib/intake-draft";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { diffDraft } from "../../intakeDelta";

// THE SHEET — the JD as a page, not as a preview pane.
//
// The draft is the artifact the whole conversation is for, and the shipped pane
// renders it as markdown filling a column: the same width, the same ground and
// the same type as the panel beside it. Console gives it a PAGE — a paper ground
// with an edge, a reading measure it does not exceed however wide the desk gets,
// and the display face on its headings. It reads as a document being typeset,
// which is what it is.
//
// A newly written section UNFOLDS: a block that was not in the previous document
// mounts closed and opens to its own height (`Collapse`, the height:auto idiom),
// so the page grows a section rather than swapping one page for another. A block
// nobody touched keeps its element and does not animate at all — the split is by
// blank line, the same units markdown already separates, so no block ever
// straddles a construct and the renderer is untouched.
//
// An EMPTY sheet draws RULES: the ghost of a heading and a few lines of body,
// dashed, at the measure the real document will take. The shipped pane wrote
// "The draft appears here once the brief has a title or requirements" — a
// sentence describing the page it is standing in the way of.

type SheetBlock = { key: string; text: string; fresh: boolean };

function toBlocks(lines: readonly string[]): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = [];
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

/** The document, its blocks, and which of them the last turn wrote. `previous`
 *  null is the FIRST page this sheet ever set, and nothing on it is news — the
 *  same rule the brief's reveal applies, so opening a finished session does not
 *  unfold nineteen turns' work section by section. */
function sheetState(md: string, previous: string[] | null): { md: string; lines: string[]; blocks: SheetBlock[] } {
  const lines = md.split("\n");
  const moved = previous === null ? { added: [], changed: [] } : diffDraft(previous, lines);
  const hot = new Set([...moved.added, ...moved.changed]);
  const blocks = toBlocks(lines).map((block) => ({
    key: `${block.from}:${block.text}`,
    text: block.text,
    fresh: [...hot].some((i) => i >= block.from && i <= block.to),
  }));
  return { md, lines, blocks };
}

/** One block. A fresh one mounts closed and opens on its first commit, which is
 *  what turns `Collapse` — built for a strip that is toggled — into an entrance:
 *  AnimatePresence does not animate its own first render, so the open has to
 *  happen one tick after the mount. */
function SheetBlockView({ block }: { block: SheetBlock }) {
  const [open, setOpen] = useState(!block.fresh);
  // A FRAME later, not synchronously: the open has to land in a commit after the
  // one that mounted the block, or `Collapse` has nothing to animate from — and
  // a synchronous setState in an effect is the cascading render the house lint
  // forbids anyway. One rAF is the cheapest honest "next commit".
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <Collapse show={open}>
      <Markdown content={block.text} className="mt-2 first:mt-0" />
    </Collapse>
  );
}

/** The empty page: the shape of a document, at the measure it will take. */
function GhostSheet() {
  const rules = ["w-1/2 h-4", "w-full h-2", "w-11/12 h-2", "w-4/5 h-2", "w-1/3 h-4", "w-full h-2", "w-3/4 h-2"];
  return (
    <div className="space-y-3" aria-hidden>
      {rules.map((rule, i) => (
        <div key={i} className={`${rule} rounded border border-dashed border-stone-200`} />
      ))}
    </div>
  );
}

export function ConsoleSheet({ brief, hasJdAttachment }: { brief: RoleBrief | null; hasJdAttachment: boolean }) {
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
  // React's own adjust-state-when-a-prop-changes pattern (state + a render-phase
  // compare), never a ref: a ref read during render is invisible to StrictMode's
  // double render, which would compare a document against itself.
  const [seen, setSeen] = useState(() => sheetState(md, null));
  let current = seen;
  if (seen.md !== md) {
    current = sheetState(md, seen.lines);
    setSeen(current);
  }
  const written = briefDraftHasContent(brief);

  return (
    <div className="flex justify-center">
      {/* The page. `bg-paper` is the app's own warm ground and it flips with the
          theme, so the sheet is a sheet in both registers rather than a white
          rectangle punched into a dark desk. */}
      <article className="w-full max-w-[46rem] rounded-lg border border-stone-200 bg-paper px-7 py-6 shadow-panel dark:rounded-2xl">
        {hasJdAttachment ? <p className="mb-3 text-meta text-steel">{t("supersedeNote")}</p> : null}
        {/* The typeset half: the display face on every heading, a reading
            measure on the prose, in one place instead of per block. */}
        <div className="[&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif [&_p]:max-w-[62ch] [&_li]:max-w-[62ch]">
          {written ? current.blocks.map((block) => <SheetBlockView key={block.key} block={block} />) : <GhostSheet />}
        </div>
      </article>
    </div>
  );
}
