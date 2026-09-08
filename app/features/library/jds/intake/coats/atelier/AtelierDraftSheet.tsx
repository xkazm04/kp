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
// This is the one element the Console direction won on, fused into the Atelier
// desk when the studio consolidated to a single surface. Atelier's own sheet had
// the typography right — a reading measure, the display face on every heading, a
// document's vertical rhythm — but it was still a column of markdown sitting on
// the same plane as everything else. Console gave it a PAGE: a paper ground with
// an edge, a measure it does not exceed however wide the desk gets. It reads as a
// document being typeset, which is what it is.
//
// A newly written section UNFOLDS: a block that was not in the previous document
// mounts closed and opens to its own height (`Collapse`, the height:auto idiom),
// so the page GROWS a section rather than flashing one. That replaces Atelier's
// `animate-arrive-in` flash and is the second half of the fusion.
//
// WHAT MOVED, NOT "SOMETHING MOVED" — a correctness property, carried through
// both sheets unchanged: the document is split at its blank lines into the blocks
// markdown already separates, each is matched against the previous render by
// `diffDraft`, and only a block holding a new or replaced line animates. An
// untouched block keeps its element and does not animate at all. `previous ===
// null` is the first document this sheet ever drew and nothing on it is news, so
// opening a finished session is still.
//
// An EMPTY sheet draws RULES: the ghost of a heading and a few lines of body,
// dashed, at the measure the real document will take. Console's ghost, not
// Atelier's — the hairline-and-gutter-dot skeleton reads as a LIST (it is the
// brief's ghost, and the brief is a list of rows), while a page owes the reader
// the shape of a page. The shipped pane wrote "The draft appears here once the
// brief has a title or requirements" — a sentence describing the page it is
// standing in the way of.

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
      <Markdown content={block.text} className="mt-3 first:mt-0" />
    </Collapse>
  );
}

/** The empty page: the document that will be written, with its slots named.
 *
 *  Dashed rules said "a page goes here" and nothing else. This says WHICH page:
 *  the posting's own headings, in the face and the measure the real document
 *  wears, each holding a bracketed slot. A requestor who has never done this can
 *  read the empty sheet and know what a finished one contains, which is the
 *  question the old grey rules left them holding. */
function ExemplarSheet() {
  const t = useTranslations("library.tab.intake.draft");
  const sections: { heading: string; slot: string }[] = [
    { heading: t("aboutRole"), slot: t("slot.body") },
    { heading: t("outcomes"), slot: t("slot.line") },
    { heading: t("whatBring"), slot: t("slot.line") },
    { heading: t("niceToHave"), slot: t("slot.line") },
  ];
  return (
    <div className="space-y-5 text-stone-400">
      <p className="font-serif text-h2 italic">{`<${t("slot.title")}>`}</p>
      {sections.map((s) => (
        <div key={s.heading} className="space-y-1">
          <p className="font-serif text-h3">{s.heading}</p>
          <p className="max-w-[62ch] italic leading-7">{`<${s.slot}>`}</p>
        </div>
      ))}
    </div>
  );
}

/** The sheet's typography, applied once to the whole page rather than fought for
 *  per block: display face on the headings, a reading leading on the prose, and a
 *  measure the eye can return from. Atelier's half of the fusion — Console set
 *  only the face and the measure, and left the heading sizes to the renderer. */
const TYPESET =
  "[&_h1]:font-serif [&_h1]:text-h2 [&_h2]:font-serif [&_h2]:text-h3 [&_h3]:font-serif [&_p]:leading-7 [&_li]:leading-7 [&_p]:max-w-[62ch] [&_li]:max-w-[62ch]";

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
        <div className={TYPESET}>
          {written ? current.blocks.map((block) => <SheetBlockView key={block.key} block={block} />) : <ExemplarSheet />}
        </div>
      </article>
    </div>
  );
}
