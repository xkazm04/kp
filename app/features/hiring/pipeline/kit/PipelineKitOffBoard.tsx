"use client";

import { useTranslations } from "next-intl";
import { ListRow, Mark, Section } from "@/app/_components/kit";
import { Menu } from "@/app/_components/kit/Menu";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { PipelineTabState } from "../usePipelineTabState";
import { moveOptions, stageName, strandedByStage } from "./pipelineKitMoves";

const NAMES = 3;

/**
 * "Off the board": candidates standing on a column this workspace removed (the retired board's
 * off-axis strip). The Sieve draws them as their own quiet layer; this caution section names each
 * retired column (by its retired label), who stands on it, and the one control that resolves it:
 * "Move all to…" a column that exists, since they were all stranded by one edit. Renders nothing
 * while nobody is stranded.
 */
export function PipelineKitOffBoard({ s }: { s: PipelineTabState }) {
  const t = useTranslations("pipeline.offAxis");
  const enumLabel = useEnumLabel();
  const groups = [...strandedByStage(s.entries ?? [], s.axis)];
  if (!groups.length) return null;
  const total = groups.reduce((n, [, g]) => n + g.length, 0);
  const label = (id: string) => stageName(id, s.axis, (x) => enumLabel("stage", x), s.retiredStages);
  const targets = moveOptions("", s.axis, (x) => enumLabel("stage", x));

  return (
    <Section title={t("title")} count={total} tone="caution" state={t("intro", { count: total })} stateMark={<Mark kind="caution" />}>
      {groups.map(([stage, stranded]) => (
        <ListRow
          key={stage}
          mark={<Mark kind="caution" />}
          name={t("onStage", { stage: label(stage), count: stranded.length })}
          sub={`${stranded.slice(0, NAMES).map((e) => e.candidateLabel).join(", ")}${stranded.length > NAMES ? ` +${stranded.length - NAMES}` : ""}`}
          fig={stranded.length}
          meta={
            <Menu
              label={t("moveAll")}
              look="button"
              size="sm"
              options={targets}
              onSelect={(to) => {
                for (const e of stranded) void s.moveEntry(e, to);
              }}
            />
          }
        />
      ))}
    </Section>
  );
}
