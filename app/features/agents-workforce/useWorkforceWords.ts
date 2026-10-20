"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { NextAction, NextActionKind } from "./agentsWorkforceLogic";
import type { DrawerKey, Drawer, Phase } from "./workforceModel";

type Key = Parameters<ReturnType<typeof useTranslations<"agentsWorkforce">>>[0];

/** The words the levels share, resolved once: a move's sentence, a needs kind's chip and short tab, a control's label,
 *  a phase's name and a drawer's name. next-intl keys are typed, so the closed vocabularies are mapped through the
 *  catalog keys the kinds name (the casts are the kind -> key joins, pinned by workforceWords.test.ts). */
export function useWorkforceWords() {
  const t = useTranslations("agentsWorkforce");
  return useMemo(() => {
    const k = (key: string) => key as Key;
    return {
      moveLine(move: NextAction): string {
        switch (move.kind) {
          case "none":
            return "";
          case "approve_in_personas":
            return move.hoursLeft == null ? t("nextAction.move.approve_no_clock") : t("nextAction.move.approve_in_personas", { hours: move.hoursLeft });
          case "check_reporter":
            return move.reason === "silent" ? t("nextAction.move.check_reporter_silent") : t("nextAction.move.check_reporter_rejected");
          default:
            return t(k(`nextAction.move.${move.kind}`));
        }
      },
      chip(kind: Exclude<NextActionKind, "none">, count: number): string {
        return t(k(`nextAction.chip.${kind}`), { count });
      },
      kindShort(kind: Exclude<NextActionKind, "none">): string {
        return t(k(`wk.kindShort.${kind}`));
      },
      phase(p: Phase): string {
        return t(k(`wk.phase.${p}`));
      },
      phasePlural(p: Phase): string {
        return t(k(`wk.phasePlural.${p}`));
      },
      status(status: string): string {
        return t(k(`status.${status === "pending_approval" ? "pendingApproval" : status}`));
      },
      controlLabel(ctl: "refresh" | "redispatch" | "integrations"): string {
        return ctl === "refresh" ? t("detail.refresh") : ctl === "redispatch" ? t("nextAction.control.redispatch") : t("nextAction.control.integrations");
      },
      controlBusy(ctl: "refresh" | "redispatch"): string {
        return ctl === "refresh" ? t("detail.refreshing") : t("nextAction.control.redispatching");
      },
      drawerName(d: Pick<Drawer, "kind" | "title">): string {
        return d.kind === "role" ? (d.title ?? "") : t(k(`wk.drawer.${d.kind}`));
      },
      drawerNameOf(key: DrawerKey | "all", drawers: readonly Drawer[]): string {
        if (key === "all") return t("wk.drawer.all");
        const d = drawers.find((x) => x.key === key);
        return d ? (d.kind === "role" ? (d.title ?? "") : t(k(`wk.drawer.${d.kind}`))) : "";
      },
    };
  }, [t]);
}

export type WorkforceWords = ReturnType<typeof useWorkforceWords>;
