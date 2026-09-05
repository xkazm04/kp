"use client";

// A candidate in a position cell: status dot, full name, fit score. Split out of
// PipelineShared.tsx.
//
// THE ROW SPENDS ITS WIDTH ON THE NAME. A stage column is 280px, and the row used to
// carry a `w-28` "Move to…" combobox plus an AI-actions button inside its flex flow.
// `opacity-0` hides pixels but still reserves layout, so ~134px of every row was
// permanently committed to controls nobody could see until they hovered, and the
// candidate's name — the one thing the cell exists to show — truncated to about a
// third of the cell. Both controls moved into PipelineCandidateMenu; what stays in
// flow is the dot, the name (flex-1) and the score, plus a 20px menu trigger.
//
// Three doors to the same menu, because the old controls had three audiences:
//   - pointer  — right-click anywhere on the row
//   - keyboard — Shift+F10 / the Menu key (both fire `contextmenu`), or the trigger,
//                which is a real focusable button revealed on focus-visible
//   - touch    — the trigger, always visible under `pointer-coarse` (a tablet has
//                neither hover nor a tab order, and HTML5 drag never fires from a
//                touch sequence, so this is the ONLY way to move a card there)
//
// PIPE1: in select mode the row becomes a checkbox (role=checkbox on the name
// button, glyph before the dot) and its navigation/actions are suppressed — the
// MatrixTab selectMode interaction grammar. The context menu is suppressed with
// them: in that mode a row is a selection target, nothing else.
//
// Memoized (candidateRowEqual): the 30s board poll used to replace the entries
// array wholesale, so every card reconciled even when nothing about it changed.
// The row now re-renders only when its entry's RENDERED content or a presentational
// flag actually changes; the handler closures (fresh per parent render) are
// excluded from the equality since their behavior is fixed by `entry`.

import { AlertCircle, AlertTriangle, CheckSquare, Clock, MoreVertical, Sparkles, Square, UserRound } from "lucide-react";
import { memo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { displayScoreOf } from "@/app/_lib/match-score";
import { moveTargetStages } from "./pipelineMoveTargets";
import { PipelineCandidateMenu, type CandidateMenuSection } from "./PipelineCandidateMenu";
import { candidateRowEqual } from "./pipelineRenderDiet";
import { useIntakeReasonText } from "./pipelineEventCatalog";
import { DEFAULT_BOARD_AXIS, daysSince, slaForStage, styleFor, type Entry, type StageDef } from "@/app/features/shared/pipelineTypes";

function CandidateRowImpl({
  entry,
  pending = false,
  stale = false,
  onOpen,
  onActions,
  selectMode = false,
  selected = false,
  onToggleSelect,
  draggable = false,
  onDragStart,
  onDragEnd,
  onMove,
  axis = DEFAULT_BOARD_AXIS,
}: {
  entry: Entry;
  pending?: boolean;
  stale?: boolean;
  onOpen: () => void;
  onActions?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // cea12908 — pointer drag-and-drop of a candidate between stage columns. Off by
  // default; the board enables it when not in select mode.
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  // bug-ui pipeline #1 (WCAG 2.1.1) — the keyboard/assistive-tech twin of the
  // pointer drag: the context menu's "Move to" section calls the SAME stage-change
  // handler the drop does. Present exactly when drag is (the board passes it
  // alongside `draggable`), so every drag has a keyboard-reachable equivalent.
  onMove?: (toStage: string) => void;
  /** The columns THIS WORKSPACE renders (the board's resolved axis). The move menu
   *  is a list of real destinations, so it has to be built from the real axis: with
   *  the compile-time default it offered the shipped five to a board that composes
   *  its own, i.e. stages set_stage answers `400 Unknown stage` while the columns
   *  that DO exist were missing from the menu. Optional so a standalone render still
   *  falls back to the shipped board, like every other axis-taking call site. */
  axis?: readonly StageDef[];
}) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const provenanceText = useScoreProvenanceText();
  // The stored degraded reason is a CODE for anything the lead intake filed - resolved
  // in the reader's language; legacy prose comes back verbatim (useIntakeReasonText).
  const degradedReason = useIntakeReasonText()(entry.intakeDegradedReason);
  const style = styleFor(entry.archetype);
  const archLabel = enumLabel("archetype", entry.archetype);
  const days = daysSince(entry.stageChangedAt);
  // Canonical match-score read path (REC-01): the badge shows THE same number as
  // the drawer header and the decisions queue; its provenance rides the tooltip.
  //
  // ONE THREAD (gap 2): a candidate promoted from an assignment may have no match
  // score yet and a work-sample TRANSFER score instead. displayScoreOf picks which
  // of the two this row is showing and names the KIND, so the number is never read
  // as the other one — an unlabelled badge means "match" (the board legend says so),
  // and a transfer score wears the kind chip beside it. The board's sort and score
  // bands stay on the match half, so a transfer score is shown, never ranked.
  const display = displayScoreOf(entry);
  const score = display?.score ?? null;
  const scoreKind = display?.kind ?? "match";
  const scoreProvenance = provenanceText(display?.provenance);
  // Intake degraded is a data-integrity problem (a non-matchable stub), so it
  // outranks every other cue: degraded (red triangle) > pending (coral pulse) >
  // aging (amber) > archetype color. State never rides on color alone — each
  // level has its own glyph.
  const degraded = !!entry.intakeDegraded;
  const dotClass = degraded ? "bg-red-600" : pending ? "bg-coral animate-pulse" : stale ? "bg-amber-400" : style.bg;
  const dotTitle = degraded
    ? `${t("candidateRow.intakeDegraded")}${degradedReason ? t("candidateRow.degradedReasonSuffix", { reason: degradedReason }) : ""}`
    : pending
      ? t("candidateRow.awaitingDecision")
      : stale
        ? t("candidateRow.aging", { days: slaForStage(entry.stage, null, axis), stage: enumLabel("stage", entry.stage) })
        : archLabel;
  const StatusIcon = degraded
    ? AlertTriangle
    : pending
      ? AlertCircle
      : stale
        ? Clock
        : style.icon;
  const scoreSuffix =
    score == null
      ? ""
      : `${scoreKind === "transfer" ? t("candidateRow.transferSuffix", { score }) : t("candidateRow.matchSuffix", { score })}${scoreProvenance ? ` (${scoreProvenance})` : ""}`;
  const title = `${t("candidateRow.cardTitle", { name: entry.candidateLabel, archetype: archLabel })}${scoreSuffix}${days != null ? t("candidateRow.daysInStage", { days }) : ""}${degraded ? t("candidateRow.degradedSuffix") : ""}`;
  const selecting = selectMode && onToggleSelect;
  // Drag only outside select mode (in select mode the row is a checkbox).
  const dragOn = draggable && !selecting;
  // bug-ui pipeline #1 — a card is keyboard-movable exactly when it's draggable
  // (never in select mode). The menu offers the valid targets a manual move can
  // succeed into (moveTargetStages, resolved on THIS board's axis — see the prop)
  // and calls the SAME onMove the drop does.
  const moveTargets = dragOn && onMove ? moveTargetStages(entry.stage, axis) : [];
  // A workspace's own column label wins, exactly as the board header and the
  // off-axis strip resolve it; the shipped stages (label === id) keep resolving
  // through enums.stage.* so they stay localized in four locales. Without this the
  // menu named a renamed column by its stored id — two names for one column on one
  // screen — and a workspace-invented id fell through to labelize().
  const targetLabel = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    if (!stage) return enumLabel("stage", id);
    return stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  };

  // Menu anchor in viewport coordinates, or null when closed. Held as the POINT the
  // gesture happened at rather than a boolean, so a right-click opens under the
  // cursor and the trigger button opens under itself.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuOn = !selecting && (!!onActions || moveTargets.length > 0);
  const sections: CandidateMenuSection[] = [
    {
      id: "open",
      items: [
        { id: "profile", label: t("candidateRow.openProfile"), Icon: UserRound, onSelect: onOpen },
        ...(onActions
          ? [{ id: "ai", label: t("candidateRow.aiActions"), Icon: Sparkles, onSelect: onActions }]
          : []),
      ],
    },
    ...(moveTargets.length > 0
      ? [
          {
            id: "move",
            label: t("candidateRow.moveTo"),
            items: moveTargets.map((s) => ({
              id: s,
              label: targetLabel(s),
              onSelect: () => onMove?.(s),
            })),
          },
        ]
      : []),
  ];
  // Shift+F10 and the Menu key both dispatch `contextmenu`, so ONE handler serves
  // pointer and keyboard. A keyboard-raised event has no meaningful clientX/Y
  // (browsers report 0 or the element corner), so fall back to the row's own rect.
  const openMenu = (ev: React.MouseEvent) => {
    if (!menuOn) return;
    ev.preventDefault();
    const fromPointer = ev.clientX > 0 || ev.clientY > 0;
    if (fromPointer) {
      setMenuAt({ x: ev.clientX, y: ev.clientY });
      return;
    }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAt({ x: r.left, y: r.bottom });
  };

  return (
    <div
      draggable={dragOn || undefined}
      onDragStart={
        dragOn
          ? (ev) => {
              // A payload makes the drag valid across the cell drop targets; the
              // board reads the dragged entry from its own state, not this string.
              ev.dataTransfer.setData("text/plain", entry.id);
              ev.dataTransfer.effectAllowed = "move";
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={dragOn ? () => onDragEnd?.() : undefined}
      onContextMenu={menuOn ? openMenu : undefined}
      className={`group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-paper ${selecting && selected ? "bg-coral/5" : ""} ${dragOn ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span
        role="img"
        aria-label={dotTitle}
        title={dotTitle}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${dotClass}`}
      >
        <StatusIcon className="h-2.5 w-2.5" aria-hidden />
      </span>
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        role={selecting ? "checkbox" : undefined}
        aria-checked={selecting ? selected : undefined}
        title={
          selecting
            ? t("candidateRow.selectCandidate", { name: entry.candidateLabel })
            : `${title}${t("candidateRow.openProfileSuffix")}${menuOn ? t("candidateRow.menuHint") : ""}`
        }
        className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-base font-medium text-ink hover:text-coral"
      >
        {selecting ? (
          selected ? (
            <CheckSquare size={14} className="shrink-0 text-coral" aria-hidden />
          ) : (
            <Square size={14} className="shrink-0 text-steel" aria-hidden />
          )
        ) : null}
        <span className="min-w-0 truncate">{entry.candidateLabel}</span>
      </button>
      {/* Right-aligned fit score in the shared score→color language (moss/amber/coral),
          so a lane can be triaged at a glance without hovering for the title tooltip.
          Canonical number (REC-01) — provenance rides the row tooltip above. */}
      {/* The kind marker rides only on a NON-match score. A bare badge means
          "match" — the board legend states that, and labelling every one of the
          board's rows with the default word would cost a card-width for no
          information. What must never be silent is the number that answers a
          DIFFERENT question, which is the defect this fixes. */}
      {scoreKind === "transfer" ? (
        <span className="shrink-0 text-meta uppercase tracking-wide text-steel" title={t("scoreKind.transferTitle")}>
          {t("scoreKind.transferShort")}
        </span>
      ) : null}
      <span className="shrink-0" title={scoreProvenance ?? undefined}>
        <ScoreBadge score={score} />
      </span>
      {menuOn ? (
        // 20px, not the 134px the old inline controls cost. It keeps its slot at all
        // times so hovering a row never reflows the name beside it; only the ink
        // fades in. Always visible on touch — see the header note.
        <button
          type="button"
          onClick={openMenu}
          aria-haspopup="menu"
          aria-expanded={menuAt != null}
          aria-label={t("candidateRow.menuFor", { name: entry.candidateLabel })}
          title={t("candidateRow.moreActions")}
          className="focus-ring shrink-0 rounded p-0.5 text-steel opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <MoreVertical size={14} aria-hidden />
        </button>
      ) : null}
      {menuAt ? (
        <PipelineCandidateMenu
          at={menuAt}
          ariaLabel={t("candidateRow.menuFor", { name: entry.candidateLabel })}
          sections={sections}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
}

// candidateRowEqual compares the RENDERED entry content; the axis is compared here,
// by identity, because it decides the move menu's contents and lives outside the
// entry. Identity is the right test: usePipelineBoardData replaces the axis object
// only when a Settings save actually changed it (JSON compare before setAxis), so a
// 30s poll keeps the same reference and the render diet is untouched — while a real
// axis edit does re-render the rows whose menu it changes.
export const CandidateRow = memo(
  CandidateRowImpl,
  (prev, next) => prev.axis === next.axis && candidateRowEqual(prev, next)
);
