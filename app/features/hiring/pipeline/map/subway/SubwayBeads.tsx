"use client";

// Candidates as beads on the track: initials inside, fill = gender hint, ring =
// score tone (all of it from avatarModelOf — never a local colour).

import { useMemo } from "react";
import { POPOVER } from "@/app/_components/ui/recipes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { avatarModelOf } from "../mapAvatar";

/** One candidate. A real button (pointer cursor, like every clickable part of the
 *  board): it opens the candidate detail, named "Actions for
 *  {name}" like the card row's menu was, so the candidate stays reachable from the
 *  board by name. */
export function Bead({
  entry,
  title,
  label,
  onOpen,
}: {
  entry: Entry;
  title: string;
  label: string;
  onOpen: () => void;
}) {
  const model = avatarModelOf(entry);
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={onOpen}
      aria-haspopup="dialog"
      className="focus-ring relative z-10 inline-flex h-[22px] w-[22px] shrink-0 cursor-pointer rounded-full bg-white ring-offset-1 ring-offset-white transition-transform hover:z-20 hover:scale-110 motion-reduce:transition-none"
    >
      {/* The tint sits on an opaque white base: a translucent fill alone let the
          bead behind show through wherever two beads overlapped. */}
      <span
        className={`${model.className} inline-flex h-full w-full items-center justify-center rounded-full text-xs font-semibold`}
      >
        {model.initials}
      </span>
    </button>
  );
}

/** The "+N" bead past the fifth candidate. Hovering it (or focusing into it) opens
 *  a names roster — everyone the row could not draw, sorted by name — so the
 *  compact board never hides WHO is standing there, only their faces. CSS only:
 *  no JS fork, no portal. */
export function BeadOverflow({
  hidden,
  title,
  label,
  onOpen,
}: {
  hidden: readonly Entry[];
  title: (e: Entry) => string;
  label: (e: Entry) => string;
  onOpen: (e: Entry) => void;
}) {
  const roster = useMemo(
    () => [...hidden].sort((a, b) => a.candidateLabel.localeCompare(b.candidateLabel)),
    [hidden],
  );
  return (
    <span className="group/more relative z-10 inline-flex">
      <span className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-stone-100 px-1.5 text-xs font-semibold text-steel ring-1 ring-stone-300 ring-offset-1 ring-offset-white group-hover/more:bg-ink group-hover/more:text-white group-focus-visible/more:bg-ink">
        +{hidden.length}
      </span>
      <span
        role="list"
        aria-label={`${hidden.length} more`}
        className={`${POPOVER} pointer-events-none invisible absolute right-0 top-full z-30 mt-1.5 max-h-72 w-max max-w-[32rem] columns-2 gap-x-3 overflow-y-auto p-1.5 text-left opacity-0 transition-opacity duration-150 group-focus-within/more:pointer-events-auto group-focus-within/more:visible group-focus-within/more:opacity-100 group-hover/more:pointer-events-auto group-hover/more:visible group-hover/more:opacity-100 motion-reduce:transition-none`}
      >
        {roster.map((e) => {
          const m = avatarModelOf(e);
          return (
            <button
              key={e.id}
              type="button"
              role="listitem"
              title={title(e)}
              aria-label={label(e)}
              onClick={() => onOpen(e)}
              className="focus-ring flex w-full cursor-pointer break-inside-avoid items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-ink hover:bg-stone-100"
            >
              <span className="inline-flex h-[18px] w-[18px] shrink-0 rounded-full bg-white">
                <span
                  className={`${m.className} inline-flex h-full w-full items-center justify-center rounded-full text-[10px] font-semibold`}
                >
                  {m.initials}
                </span>
              </span>
              <span className="truncate">{e.candidateLabel}</span>
              <span className="ml-auto pl-2 text-xs text-steel nums">{m.score ?? "—"}</span>
            </button>
          );
        })}
      </span>
    </span>
  );
}
