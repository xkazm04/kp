"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { Select } from "@/app/_components/Select";
import { cohortSelectNs, type GateMode, type RoundKind } from "../pipelineComposerModel";
import { setPolicy, type Composer, type PolicyRow } from "./hiringKitModel";

const MODE_TIP = { screening: "tipModeScreening", homework: "tipModeHomework", scoring: "tipModeScoring", offer: "tipModeOffer" } as const;

/** A decision the product makes for you: quiet text on the control's footprint, its sentence as
 *  the tip (focusable), because a control that can never be operated reads as broken, not settled. */
function Stated({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="k-absent" data-tip={tip} tabIndex={0}>
      {label}
    </span>
  );
}

/** The `hiringPlan` translator a row's cells are worded with. */
export type PlanT = ReturnType<typeof useTranslations<"hiringPlan">>;

/**
 * The executor and guard cells of one step row - today's table's two policy buttons, as kit
 * buttons: each SHOWS the current answer and a click flips it; the catalog sentence (which says
 * what a click does) is the tip. A decision the type fixes is stated, not offered. A plain function
 * (the caller's translator passed in), since it runs once per row inside a map.
 */
export function policyCells(t: PlanT, c: Composer, rows: PolicyRow[], stage: string) {
  const plan = c.plan;
  if (!plan) return { executor: null, guard: null, cohort: null };
  const edit = (row: PolicyRow, value: GateMode | RoundKind | number | null) => c.setPlan(setPolicy(plan, row, value));
  const exec = rows.find((r) => r.dim === "executor");
  const guard = rows.find((r) => r.dim === "guard" || r.dim === "scorecard");
  const cohort = rows.find((r) => r.dim === "cohort");
  const role = guard?.role ?? exec?.role;

  const executor = exec ? (
    <Button
      label={exec.value === "ai" ? t("kindAi") : t("kindHuman")}
      size="sm"
      className="w-full"
      aria-label={t("kindAriaFor", { stage })}
      tip={t(exec.value === "ai" ? "tipKindAi" : "tipKindHuman")}
      onClick={() => edit(exec, exec.value === "ai" ? "human" : "ai")}
    />
  ) : role && role !== "interview" ? (
    <Stated label={t("kindAi")} tip={t(MODE_TIP[role as keyof typeof MODE_TIP])} />
  ) : null;

  const guardCell = !guard ? null : guard.dim === "scorecard" ? (
    <Stated label={t("gateShortHuman")} tip={t("tipScorecard")} />
  ) : (
    <Button
      label={guard.value === "human" ? t("gateShortHuman") : t("gateAuto")}
      size="sm"
      className="w-full"
      aria-label={t("gateAriaFor", { stage })}
      tip={t(guard.value === "human" ? "tipGateHuman" : "tipGateAuto")}
      onClick={() => edit(guard, guard.value === "human" ? "auto" : "human")}
    />
  );

  const cohortCell = cohort ? (
    <Select
      value={cohort.value == null ? "all" : String(cohort.value)}
      onChange={(v) => edit(cohort, v === "all" ? null : Number(v))}
      ariaLabel={t("cohortAriaFor", { stage })}
      sizeVariant="sm"
      className="w-full"
      options={[{ value: "all", label: t("cohortEveryone") }, ...cohortSelectNs().map((n) => ({ value: String(n), label: t("cohortTopN", { n }) }))]}
    />
  ) : null;

  return { executor, guard: guardCell, cohort: cohortCell };
}
