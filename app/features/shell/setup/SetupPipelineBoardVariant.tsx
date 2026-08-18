"use client";

/**
 * Pipeline step — variant "board".
 *
 * Metaphor: **the board itself, before it has anyone on it.** The columns are
 * drawn left to right in the order the real Pipeline tab draws them, each one a
 * card the operator can type into, so the step answers "what will my board look
 * like" by SHOWING it rather than describing it. Recognition over instruction —
 * the first-run reader has never seen this app's board, and this is the cheapest
 * possible preview of it.
 *
 * Differs from the presets variant: no shapes to choose from, no opinion offered.
 * Every column is equally editable and the default is simply what ships. The
 * trade is expressiveness for immediacy — you see the funnel, you don't get told
 * which funnel to want.
 *
 * Safe by construction (see setupPipelineEdit.ts): the two structural columns
 * (arrives-here, hired) can't be removed, moved or re-roled, so no click here can
 * produce a shape the server would refuse. Occupied columns lose their remove
 * button rather than failing at save.
 */

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronRight, Plus, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_SECONDARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { usePipelineStageRoleLabel, useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import type { PipelineStageRoleWire } from "@/app/_lib/decision-config-schema";
import { SETUP_STAGE_ROLES, type SetupPipelineEdit } from "./setupPipelineEdit";

export function SetupPipelineBoardVariant({ edit }: { edit: SetupPipelineEdit }) {
  const t = useTranslations("setup.pipeline");
  const reduced = useReducedMotion();
  const roleLabel = usePipelineStageRoleLabel();
  const displayLabel = useStageDisplayLabel();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={META_LABEL}>{t("meta", { count: edit.stages.length, max: edit.max })}</span>
        <button
          type="button"
          onClick={edit.add}
          disabled={edit.atMax}
          className={`${BTN_SECONDARY} h-8 gap-1.5 px-2.5 text-sm font-semibold`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addStep")}
        </button>
      </div>

      {/* The board scrolls sideways exactly like the real one: eight columns never
          fit a modal, and shrinking them to fit would make the preview lie about
          how the board reads. */}
      <div className="-mx-1 mt-2 overflow-x-auto px-1 pb-2">
        <ol className="flex min-w-max items-stretch gap-1.5" aria-label={t("boardAria")}>
          {edit.stages.map((stage, i) => {
            const fixed = edit.isFixed(stage);
            const here = edit.occupants(stage);
            return (
              <motion.li
                key={stage.id}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduced ? { duration: 0 } : { duration: 0.25, delay: Math.min(i * 0.05, 0.3) }}
                className="flex items-center gap-1.5"
              >
                {/* Measured, not chosen: five cards plus their four arrow gaps come
                    to 5×136 + 4×26 = 784px, inside the 814px the pane offers at the
                    card's full width — so the SHIPPED axis never opens
                    already-scrolled. Add a sixth column and it scrolls, which is
                    the honest moment for it. */}
                <div className={`${PANEL} flex w-[8.5rem] shrink-0 flex-col gap-2 p-2.5`}>
                  <div className="flex h-5 items-center justify-between gap-1">
                    <span className="nums text-meta uppercase text-stone-400">{i + 1}</span>
                    {fixed ? null : (
                      <button
                        type="button"
                        onClick={() => edit.remove(stage)}
                        disabled={!edit.canRemove(stage)}
                        title={here > 0 ? t("occupiedHint", { count: here }) : undefined}
                        aria-label={t("removeAria", { stage: displayLabel(stage) })}
                        className="focus-ring rounded-md p-0.5 text-steel transition-colors hover:text-coral disabled:opacity-40 disabled:hover:text-steel"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    )}
                  </div>

                  <TextInput
                    type="text"
                    value={displayLabel(stage)}
                    onChange={(e) => edit.rename(stage, e.target.value)}
                    aria-label={t("labelAria", { position: i + 1 })}
                    sizeVariant="sm"
                    className="w-full"
                  />

                  {/* Same slot in every card: the middle columns get the role
                      PICKER, the two structural ones a statement of the role they
                      already hold. Parallel position keeps the five cards' rows
                      aligned, and it puts "what this column means" in one place
                      instead of two. */}
                  {fixed ? (
                    <p className="flex h-9 items-center text-meta uppercase leading-tight text-moss">{roleLabel(stage.role)}</p>
                  ) : (
                    <Select
                      value={stage.role}
                      onChange={(role) => edit.setRole(stage, role as PipelineStageRoleWire)}
                      ariaLabel={t("roleAria", { stage: displayLabel(stage) })}
                      sizeVariant="sm"
                      className="w-full"
                      options={SETUP_STAGE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
                    />
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => edit.move(stage, -1)}
                      disabled={!edit.canMove(stage, -1)}
                      aria-label={t("moveEarlierAria", { stage: displayLabel(stage) })}
                      className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
                    >
                      <ArrowLeft size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => edit.move(stage, 1)}
                      disabled={!edit.canMove(stage, 1)}
                      aria-label={t("moveLaterAria", { stage: displayLabel(stage) })}
                      className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
                    >
                      <ArrowRight size={13} aria-hidden />
                    </button>
                    {/* Only shown when it's true, and it's the reason the remove
                        button above is disabled — never a decoration. */}
                    {here > 0 ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-sm text-steel" title={t("occupiedHint", { count: here })}>
                        <Users size={12} aria-hidden /> <span className="nums">{here}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
                {i < edit.stages.length - 1 ? (
                  <ChevronRight size={14} aria-hidden className="shrink-0 text-stone-400" />
                ) : null}
              </motion.li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
