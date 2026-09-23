"use client";

// Candidates as beads on the track: initials inside, fill = gender hint, ring =
// score tone (all of it from avatarModelOf — never a local colour).

import { useMemo } from "react";
import { AlertTriangle, Check, CheckSquare, Square } from "lucide-react";
import { POPOVER } from "@/app/_components/ui/recipes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { avatarModelOf } from "../mapAvatar";
import { beadA11y, beadIntent } from "./subwayInteraction";

/** What a bead can do besides opening. Absent = the plain open-only bead. */
export type BeadActions = {
  /** Select mode: the bead is a checkbox and nothing else. */
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Outside select mode, when the board can move: the drag source and the
   *  Move-to menu door (right-click, Shift+F10, the Menu key). */
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMenu?: (at: { x: number; y: number }) => void;
};

/** A contextmenu raised from the keyboard (Shift+F10, the Menu key) carries no
 *  meaningful pointer position, so the menu opens under the element instead. */
export function menuPoint(ev: React.MouseEvent): { x: number; y: number } {
  if (ev.clientX > 0 || ev.clientY > 0) return { x: ev.clientX, y: ev.clientY };
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

/** One candidate. A real button (pointer cursor, like every clickable part of the
 *  board): it opens the candidate detail, named "Actions for {name}" like the card
 *  row's menu was, so the candidate stays reachable from the board by name. In
 *  select mode it is a checkbox instead (subwayInteraction.beadA11y); outside it,
 *  it is draggable onto a legal station of its own line and opens the Move-to menu
 *  on right-click / Shift+F10. The DRAG SOURCE is the wrapping span, not the
 *  button - Firefox does not start a drag from a <button>. */
export function Bead({
  entry,
  title,
  label,
  selectLabel,
  menuHint = "",
  onOpen,
  bouncedReason,
  actions,
}: {
  entry: Entry;
  title: string;
  label: string;
  /** The checkbox name in select mode ("Select {name}"). */
  selectLabel: string;
  /** Appended to the tooltip when the Move-to menu is reachable. */
  menuHint?: string;
  onOpen: () => void;
  bouncedReason?: string | null;
  actions?: BeadActions;
}) {
  const model = avatarModelOf(entry);
  const selectMode = actions?.selectMode ?? false;
  const selected = actions?.selected ?? false;
  const a11y = beadA11y({ selectMode, selected });
  const intent = beadIntent({ selectMode }, entry);
  const dragOn = !!actions && !selectMode && actions.draggable;
  const onMenu = !selectMode ? actions?.onMenu : undefined;
  const baseTitle = selectMode ? selectLabel : `${title}${onMenu ? menuHint : ""}`;
  return (
    <span
      draggable={dragOn || undefined}
      onDragStart={
        dragOn
          ? (ev) => {
              // A payload makes the drag valid across the station drop targets; the
              // board reads the dragged entry from its own state, not this string.
              ev.dataTransfer.setData("text/plain", entry.id);
              ev.dataTransfer.effectAllowed = "move";
              actions?.onDragStart();
            }
          : undefined
      }
      onDragEnd={dragOn ? () => actions?.onDragEnd() : undefined}
      className={`relative z-10 inline-flex shrink-0 rounded-full hover:z-20 ${dragOn ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <button
        type="button"
        title={bouncedReason ? `${baseTitle} — ${bouncedReason}` : baseTitle}
        aria-label={selectMode ? selectLabel : bouncedReason ? `${label}. ${bouncedReason}` : label}
        role={a11y.role}
        aria-checked={a11y.checked}
        onClick={intent.kind === "toggle" ? actions?.onToggle : onOpen}
        onContextMenu={
          onMenu
            ? (ev) => {
                ev.preventDefault();
                onMenu(menuPoint(ev));
              }
            : undefined
        }
        aria-haspopup={selectMode ? undefined : "dialog"}
        className={`focus-ring relative inline-flex h-[22px] w-[22px] shrink-0 rounded-full bg-white ring-offset-1 ring-offset-white transition-transform hover:scale-110 motion-reduce:transition-none ${
          selectMode ? (selected ? "ring-2 ring-coral" : "ring-1 ring-stone-300") : ""
        } ${dragOn ? "cursor-grab" : "cursor-pointer"}`}
      >
        {/* The tint sits on an opaque white base: a translucent fill alone let the
            bead behind show through wherever two beads overlapped. */}
        <span
          className={`${model.className} inline-flex h-full w-full items-center justify-center rounded-full text-xs font-semibold`}
        >
          {model.initials}
        </span>
        {selectMode && selected ? (
          <Check aria-hidden className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-coral p-px text-white" />
        ) : bouncedReason ? (
          <AlertTriangle aria-hidden className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white text-coral" />
        ) : null}
      </button>
    </span>
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
  selection,
  onMenu,
}: {
  hidden: readonly Entry[];
  title: (e: Entry) => string;
  label: (e: Entry) => string;
  onOpen: (e: Entry) => void;
  /** Select mode: every roster name is a checkbox, exactly like a drawn bead. */
  selection?: { isSelected: (e: Entry) => boolean; onToggle: (e: Entry) => void; label: (e: Entry) => string } | null;
  /** The Move-to menu door for a name the row could not draw (outside select mode). */
  onMenu?: (e: Entry, at: { x: number; y: number }) => void;
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
        role={selection ? "group" : "list"}
        aria-label={`${hidden.length} more`}
        className={`${POPOVER} pointer-events-none invisible absolute right-0 top-full z-30 mt-1.5 max-h-72 w-max max-w-[32rem] columns-2 gap-x-3 overflow-y-auto p-1.5 text-left opacity-0 transition-opacity duration-150 group-focus-within/more:pointer-events-auto group-focus-within/more:visible group-focus-within/more:opacity-100 group-hover/more:pointer-events-auto group-hover/more:visible group-hover/more:opacity-100 motion-reduce:transition-none`}
      >
        {roster.map((e) => {
          const m = avatarModelOf(e);
          const checked = selection ? selection.isSelected(e) : false;
          return (
            <button
              key={e.id}
              type="button"
              role={selection ? "checkbox" : "listitem"}
              aria-checked={selection ? checked : undefined}
              title={selection ? selection.label(e) : title(e)}
              aria-label={selection ? selection.label(e) : label(e)}
              onClick={() => (selection ? selection.onToggle(e) : onOpen(e))}
              onContextMenu={
                !selection && onMenu
                  ? (ev) => {
                      ev.preventDefault();
                      onMenu(e, menuPoint(ev));
                    }
                  : undefined
              }
              className={`focus-ring flex w-full cursor-pointer break-inside-avoid items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-ink hover:bg-stone-100 ${checked ? "bg-coral/10" : ""}`}
            >
              {selection ? (
                checked ? (
                  <CheckSquare aria-hidden className="h-3.5 w-3.5 shrink-0 text-coral" />
                ) : (
                  <Square aria-hidden className="h-3.5 w-3.5 shrink-0 text-steel" />
                )
              ) : null}
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
