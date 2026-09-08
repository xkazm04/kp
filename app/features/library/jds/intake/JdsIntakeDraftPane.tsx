"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { briefDraftHasContent, briefDraftMarkdown } from "@/app/_lib/intake-draft";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { diffDraft } from "./intakeDelta";
import type { IntakeAttachment } from "./jdsIntakeLogic";

// The live JD draft — the "watch it being written" pane: a deterministic
// posting-shaped render of the current RoleBrief that updates after every
// exchange (no LLM cost; the FINAL JD is still generated at Promote).
//
// The pane is DOCUMENT ONLY. It used to open with a title row ("Job
// description draft" + a working-draft chip) and a two-line explainer of what
// the pane is, then put the posting inside a second bordered card — three
// chrome layers between the leaf header and the words the requestor came to
// read, one of them repeating the leaf header's own title. The title and its
// status chip are now ONE row, owned by the leaf header
// (JdsIntakeLayoutTriptych's `draftChip`), and the markdown renders straight
// into the leaf.
//
// WHAT MOVED, NOT "SOMETHING MOVED". The whole document used to fade on every
// brief change (`key={md}`), which says "this changed" about a posting where two
// words out of four hundred are new — the requestor then has to re-read it to
// find them. The document is now split at its blank lines into BLOCKS (a heading,
// a paragraph, a list — the units markdown already separates), each block is
// matched against the previous render by `diffDraft` (pure, `intakeDelta.ts`), and
// only the blocks holding a new or replaced line flash. A block nobody touched
// keeps its element, so it does not animate at all.
//
// Blank-line boundaries are the split, so no block ever straddles a construct:
// `Markdown` sees exactly the same text it saw as one document, one piece at a
// time. That is the whole trick — the renderer is untouched.

/** One blank-line-separated block, with the line range it occupies in the
 *  document (so a diff over LINES can be read as a verdict over BLOCKS). */
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

/** The document, its blocks, and which of those blocks the last turn moved.
 *  `previous === null` is the FIRST document this pane ever drew, and nothing on
 *  it is news — the same rule the brief's reveal and arrival both apply, so
 *  opening a finished session does not flash its whole JD. */
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

export function JdsIntakeDraftPane({ brief, attachments }: { brief: RoleBrief | null; attachments: IntakeAttachment[] }) {
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
  // The previous document, and the verdict it produced — React's own
  // adjust-state-when-a-prop-changes pattern (state plus a render-phase compare,
  // never a ref: reading a ref during render is what `react-hooks/refs` forbids,
  // and rightly — a ref read is invisible to the compiler and to StrictMode's
  // double render, which would compare a document against itself and conclude
  // nothing moved). The set is keyed on `md`, so this recomputes exactly once per
  // new document and `current` carries the answer through the very render that
  // asked for it.
  const [seen, setSeen] = useState(() => draftState(md, null));
  let current = seen;
  if (seen.md !== md) {
    current = draftState(md, seen.lines);
    setSeen(current);
  }
  const blocks = current.blocks;
  const hasJdAttachment = attachments.some((a) => a.kind === "jd");

  if (!briefDraftHasContent(brief)) {
    return <p className="text-body text-steel">{t("empty")}</p>;
  }
  return (
    <>
      {hasJdAttachment ? <p className="mb-3 text-meta text-steel">{t("supersedeNote")}</p> : null}
      {/* ONE wrapper, N renderers. The leaf that hosts this pane spaces its
          children (`space-y-4` in JdsIntakeLayoutTriptych), so returning the
          blocks bare would push the posting's own paragraphs apart by a section
          gap each. Inside the wrapper, a non-first block carries `mt-2` — the
          margin `Markdown`'s own `first:mt-0` drops from a block that is now the
          first child of its own root. Margins collapse through the wrapper, so a
          heading or list that already had a larger one keeps it. */}
      <div>
        {blocks.map((block, i) => (
          // The key carries the block's own text, so an untouched block keeps its
          // element (no animation) while a rewritten one is a new element — which
          // is what makes the CSS class replay. `animate-arrive-in` is already
          // flattened under reduced motion in globals.css.
          <Markdown
            key={`${block.from}:${block.text}`}
            content={block.text}
            className={`${i > 0 ? "mt-2" : ""}${block.moved ? " animate-arrive-in" : ""}`}
          />
        ))}
      </div>
    </>
  );
}
