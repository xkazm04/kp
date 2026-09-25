"use client";

import { useTranslations } from "next-intl";
import { Clip, Mark, Section, Segmented, SelectField, SettingRow, Tag } from "@/app/_components/kit";
import type { MarkKind } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import { cohortSelectNs, type GateMode, type RoundKind } from "../pipelineComposerModel";
import { firstSentence, policyRows, setPolicy, type Composer, type PolicyRow } from "./hiringKitModel";

const MODE_TIP = { screening: "tipModeScreening", homework: "tipModeHomework", scoring: "tipModeScoring", offer: "tipModeOffer" } as const;

function markOf(row: PolicyRow): MarkKind | null {
  if (row.dim === "cohort") return null;
  if (row.dim === "scorecard") return "human";
  return row.value === "human" ? "human" : "machine";
}

/**
 * Who runs each step and who signs it off: one setting row per DECISION, in board order - the
 * current table's cohort / executor / guard slots, each with the sentence that says what it
 * means beside it. Types decide which rows exist (policyRows); a binary choice is a Segmented
 * that shows both answers, the cohort a select over the composer's own list. Every change is a
 * draft edit through the same plan functions PipelineStepPolicy calls; Save stores it.
 */
export function HiringKitPolicy({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan");
  const fmt = useDateFormat();
  const display = useStageDisplayLabel();
  const plan = c.plan;
  const draft = c.axis;
  if (!plan || !draft) return null;
  const rows = policyRows(plan, c.savedPlan, draft.stages);
  const nameOf = new Map(draft.stages.map((s) => [s.id, display(s)]));
  const stored = c.versions.interviewPlan ?? null;
  const edit = (row: PolicyRow, value: GateMode | RoundKind | number | null) => c.setPlan(setPolicy(plan, row, value));
  const gateTip = (v: GateMode) => firstSentence(t(v === "human" ? "tipGateHuman" : "tipGateAuto"));

  const markTip = (row: PolicyRow, kind: MarkKind) =>
    row.stacked
      ? t("tipStackedRounds", { count: row.stacked })
      : row.dim === "executor"
        ? t(row.value === "ai" ? "kindAi" : "kindHuman")
        : kind === "human"
          ? t("gateHuman")
          : t("impact.unattended");

  const cell = (row: PolicyRow, stage: string) => {
    switch (row.dim) {
      case "cohort":
        return {
          sub: t("colCohort"),
          why: t("kit.cohortWhy"),
          control: (
            <SelectField
              size="sm"
              label={t("cohortAriaFor", { stage })}
              value={row.value == null ? "all" : String(row.value)}
              onChange={(v) => edit(row, v === "all" ? null : Number(v))}
              options={[{ value: "all", label: t("cohortEveryone") }, ...cohortSelectNs().map((n) => ({ value: String(n), label: t("cohortTopN", { n }) }))]}
            />
          ),
        };
      case "executor":
        return {
          sub: t("colExecutor"),
          // A legacy stack says so in two words; the long explanation rides the row's caution mark.
          why: row.stacked ? t("stackedRounds", { count: row.stacked }) : firstSentence(t(row.value === "ai" ? "tipKindAi" : "tipKindHuman")),
          control: (
            <Segmented
              label={t("kindAriaFor", { stage })}
              value={String(row.value)}
              onChange={(v) => edit(row, v as RoundKind)}
              items={[
                { value: "ai", label: t("kindAi"), tip: firstSentence(t("tipKindAi")) },
                { value: "human", label: t("kindHuman"), tip: firstSentence(t("tipKindHuman")) },
              ]}
            />
          ),
        };
      case "scorecard":
        return { sub: t("colGuard"), why: t("tipScorecard"), control: <Tag label={t("gateShortHuman")} /> };
      default:
        return {
          sub: t("colGuard"),
          why: row.role === "interview" ? gateTip(row.value as GateMode) : t(MODE_TIP[row.role as keyof typeof MODE_TIP]),
          control: (
            <Segmented
              label={t("gateAriaFor", { stage })}
              value={String(row.value)}
              onChange={(v) => edit(row, v as GateMode)}
              items={[
                { value: "human", label: t("gateShortHuman"), tip: gateTip("human") },
                { value: "auto", label: t("gateAuto"), tip: gateTip("auto") },
              ]}
            />
          ),
        };
    }
  };

  return (
    <Section
      title={t("kit.policyTitle")}
      state={stored ? t("kit.savedOn", { date: fmt.date(stored) }) : t("kit.neverSaved")}
      stateMark={stored ? undefined : <Mark kind="unknown" />}
    >
      {rows.length === 0 ? <SettingRow name={t("kit.policyNone")} state={["muted"]} /> : null}
      {rows.map((row) => {
        const stage = nameOf.get(row.stageId) ?? row.stageId;
        const { sub, why, control } = cell(row, stage);
        const kind = row.stacked ? "caution" : markOf(row);
        return (
          <SettingRow
            key={row.key}
            mark={kind ? <Mark kind={kind} tip={markTip(row, kind)} /> : null}
            name={stage}
            sub={sub}
            consequence={<Clip text={why} />}
            control={control}
            state={row.dim === "scorecard" ? ["muted"] : row.changed ? ["changed"] : []}
          />
        );
      })}
    </Section>
  );
}
