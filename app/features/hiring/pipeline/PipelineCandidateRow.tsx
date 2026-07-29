"use client";

// A candidate in a position cell: full name + a prominent status dot (~2x the
// old avatar corner dot). The name navigates to the analyzed profile; a hover
// affordance opens the AI-actions drawer. Split out of PipelineShared.tsx.
//
// PIPE1: in select mode the row becomes a checkbox (role=checkbox on the name
// button, glyph before the dot) and its navigation/actions are suppressed — the
// MatrixTab selectMode interaction grammar.
//
// Memoized (candidateRowEqual): the 30s board poll used to replace the entries
// array wholesale, so every card reconciled even when nothing about it changed.
// The row now re-renders only when its entry's RENDERED content or a presentational
// flag actually changes; the handler closures (fresh per parent render) are
// excluded from the equality since their behavior is fixed by `entry`.

import { AlertCircle, AlertTriangle, CheckSquare, Clock, Sparkles, Square } from "lucide-react";
import { memo } from "react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { Select } from "@/app/_components/Select";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";
import { moveTargetStages } from "./pipelineMoveTargets";
import { candidateRowEqual } from "./pipelineRenderDiet";
import { daysSince, slaForStage, styleFor, type Entry } from "@/app/features/shared/pipelineTypes";

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
  // pointer drag: a focusable "Move to…" menu that calls the SAME stage-change
  // handler the drop does. Present exactly when drag is (the board passes it
  // alongside `draggable`), so every drag has a keyboard-reachable equivalent.
  onMove?: (toStage: string) => void;
}) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const provenanceText = useScoreProvenanceText();
  const style = styleFor(entry.archetype);
  const archLabel = enumLabel("archetype", entry.archetype);
  const days = daysSince(entry.stageChangedAt);
  // Canonical match-score read path (REC-01): the badge shows THE same number as
  // the drawer header and the decisions queue; its provenance rides the tooltip.
  const score = canonicalScoreOf(entry);
  const scoreProvenance = provenanceText(provenanceOf(entry));
  // Intake degraded is a data-integrity problem (a non-matchable stub), so it
  // outranks every other cue: degraded (red triangle) > pending (coral pulse) >
  // aging (amber) > archetype color. State never rides on color alone — each
  // level has its own glyph.
  const degraded = !!entry.intakeDegraded;
  const dotClass = degraded ? "bg-red-600" : pending ? "bg-coral animate-pulse" : stale ? "bg-amber-400" : style.bg;
  const dotTitle = degraded
    ? `${t("candidateRow.intakeDegraded")}${entry.intakeDegradedReason ? t("candidateRow.degradedReasonSuffix", { reason: entry.intakeDegradedReason }) : ""}`
    : pending
      ? t("candidateRow.awaitingDecision")
      : stale
        ? t("candidateRow.aging", { days: slaForStage(entry.stage), stage: enumLabel("stage", entry.stage) })
        : archLabel;
  const StatusIcon = degraded
    ? AlertTriangle
    : pending
      ? AlertCircle
      : stale
        ? Clock
        : style.icon;
  const title = `${t("candidateRow.cardTitle", { name: entry.candidateLabel, archetype: archLabel })}${score != null ? `${t("candidateRow.matchSuffix", { score })}${scoreProvenance ? ` (${scoreProvenance})` : ""}` : ""}${days != null ? t("candidateRow.daysInStage", { days }) : ""}${degraded ? t("candidateRow.degradedSuffix") : ""}`;
  const selecting = selectMode && onToggleSelect;
  // Drag only outside select mode (in select mode the row is a checkbox).
  const dragOn = draggable && !selecting;
  // bug-ui pipeline #1 — a card is keyboard-movable exactly when it's draggable
  // (never in select mode). The "Move to…" menu offers the valid targets a manual
  // move can succeed into (moveTargetStages) and calls the SAME onMove the drop does.
  const moveOn = dragOn && !!onMove;
  const moveTargets = moveOn ? moveTargetStages(entry.stage) : [];
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
        title={selecting ? t("candidateRow.selectCandidate", { name: entry.candidateLabel }) : `${title}${t("candidateRow.openProfileSuffix")}`}
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
      <span className="shrink-0" title={scoreProvenance ?? undefined}>
        <ScoreBadge score={score} />
      </span>
      {moveOn && moveTargets.length > 0 ? (
        // The keyboard/AT twin of drag: a focusable listbox (Select is the APG
        // combobox — arrows/Enter/Esc/typeahead, portalled so it escapes the
        // board's overflow-x-auto clip). Revealed on hover OR focus so a keyboard
        // user sees it when it lands in the tab order; the move funnels through
        // the same onMove handler the drop calls. pointer-coarse: always visible —
        // touch has neither hover nor a tab order, and HTML5 drag never fires from
        // a touch sequence, so on a tablet this Select is the ONLY working way to
        // move a candidate.
        <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <Select
            value=""
            onChange={(v) => {
              if (v) onMove?.(v);
            }}
            options={moveTargets.map((s) => ({ value: s, label: enumLabel("stage", s) }))}
            placeholder={t("candidateRow.moveTo")}
            ariaLabel={t("candidateRow.moveToFor", { name: entry.candidateLabel })}
            size="sm"
            className="w-28"
          />
        </span>
      ) : null}
      {onActions && !selecting ? (
        <button
          type="button"
          onClick={onActions}
          aria-label={t("candidateRow.aiActionsFor", { name: entry.candidateLabel })}
          title={t("candidateRow.aiActions")}
          className="focus-ring shrink-0 rounded p-0.5 text-steel opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:p-2 pointer-coarse:opacity-100"
        >
          <Sparkles size={14} />
        </button>
      ) : null}
    </div>
  );
}

export const CandidateRow = memo(CandidateRowImpl, candidateRowEqual);
