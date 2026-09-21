"use client";

// No score, no branch: unscored candidates get their own shelf at the right. Each
// is listed by FULL NAME (not initials) — the same rule the tickets follow — and
// opens the candidate detail like a ticket does.

import { META_LABEL } from "@/app/_components/ui/recipes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { ORCHARD_COPY as COPY } from "./orchardCopy";

export function UnscoredBay({ entries, onOpen }: { entries: readonly Entry[]; onOpen: (e: Entry) => void }) {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3">
      <p className={META_LABEL}>{COPY.unscored}</p>
      <p className="nums text-sm text-steel">{entries.length}</p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpen(e)}
              aria-label={COPY.ticketAria(e.candidateLabel, null, null)}
              aria-haspopup="dialog"
              className="focus-ring w-full cursor-pointer break-words rounded-md border border-dashed border-stone-300 bg-white px-2.5 py-1.5 text-left text-sm font-medium text-ink transition-colors hover:bg-stone-100"
            >
              {e.candidateLabel}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
