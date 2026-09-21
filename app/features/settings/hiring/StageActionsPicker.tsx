"use client";

// Which AI actions a recruiter can run on a candidate standing in ONE step — the
// per-step customisation of app/_lib/stage-ai-actions.ts, edited on the Settings →
// Hiring steps table.
//
// The product default (by the step's TYPE) is what a step offers until someone picks
// otherwise, and each default action is marked so. A selection that equals the
// default stores NOTHING: the step then follows a later change to the default rather
// than freezing today's list. "Reset to default" does the same explicitly. An empty
// selection is allowed and means what it says — nothing runs at this step; the
// candidate modal says so, and the server refuses a manual run there.

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/app/_components/Checkbox";
import { BTN_GHOST, BTN_SECONDARY, META_LABEL, POPOVER } from "@/app/_components/ui/recipes";
import { STAGE_AI_ACTIONS, type StageAiAction, type StageDef } from "@/app/_lib/pipeline-stages";
import { defaultStageActions, isDefaultStageActions, stageActions } from "@/app/_lib/stage-ai-actions";

export function StageActionsPicker({
  stageId,
  stageLabel,
  axis,
  onChange,
}: {
  stageId: string;
  stageLabel: string;
  /** The DRAFT axis, so a role change mid-edit re-derives the default at once. */
  axis: readonly StageDef[];
  /** A custom list, or `undefined` for "follow the default". */
  onChange: (actions: readonly StageAiAction[] | undefined) => void;
}) {
  const t = useTranslations("hiringPlan.steps");
  const tActions = useTranslations("pipeline.actions");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const defaults = defaultStageActions(stageId, axis);
  const current = stageActions(stageId, axis);
  const custom = axis.find((s) => s.id === stageId)?.actions !== undefined;

  // A light popover: a pointer outside or Escape closes it; nothing is modal.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: StageAiAction) => {
    const next = STAGE_AI_ACTIONS.filter((a) => (a === id ? !current.includes(a) : current.includes(a)));
    onChange(isDefaultStageActions(stageId, next, axis) ? undefined : next);
  };
  const aria = t("actionsAria", { stage: stageLabel });

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={aria}
        onClick={() => setOpen((o) => !o)}
        className={`${BTN_SECONDARY} h-8 w-full cursor-pointer justify-between gap-1.5 bg-white px-2 text-sm`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <Sparkles size={13} className="shrink-0 text-coral" aria-hidden />
          {current.length === 0 ? t("actionsNone") : t("actionsCount", { count: current.length })}
        </span>
        <span className={META_LABEL}>{custom ? t("actionsCustom") : t("actionsDefault")}</span>
      </button>
      {open ? (
        <div id={panelId} role="group" aria-label={aria} className={`${POPOVER} absolute right-0 top-full z-30 mt-1 w-64 p-3`}>
          <p className="text-sm text-steel">{t("actionsHint")}</p>
          <ul className="mt-2 space-y-1.5">
            {STAGE_AI_ACTIONS.map((id) => (
              <li key={id}>
                <Checkbox
                  checked={current.includes(id)}
                  onChange={() => toggle(id)}
                  label={
                    <span className="text-sm text-ink">
                      {tActions(id)}
                      {defaults.includes(id) ? <span className="text-steel"> · {t("actionsDefault")}</span> : null}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
          {custom ? (
            <button type="button" onClick={() => onChange(undefined)} className={`${BTN_GHOST} mt-2 cursor-pointer px-2 py-1 text-sm`}>
              {t("actionsReset")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
