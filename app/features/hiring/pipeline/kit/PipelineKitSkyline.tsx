"use client";

import { useTranslations } from "next-intl";
import { Section, Segmented, type PartState } from "@/app/_components/kit";
import { Skyline, type SkylineItem } from "@/app/_components/kit/graphic";
import type { PipelineKit } from "./usePipelineKit";

type Preset = "all" | "top10" | "over70" | "never";

/** "Match, every candidate": each entry one bar ranked by match; brushing a range filters the dots and the list. */
export function PipelineKitSkyline({ k, status }: { k: PipelineKit; status: PartState }) {
  const t = useTranslations("pipeline.kit");
  const tone = new Map(k.layers.map((l) => [l.id, l.tone]));
  const items: SkylineItem[] = k.ranked.map((e) => ({
    id: e.id,
    value: k.ctx.score(e),
    tone: tone.get(e.stage) ?? "default",
    needs: k.ctx.needs(e),
    label: `${e.candidateLabel} · ${k.layers.find((l) => l.id === e.stage)?.label ?? e.stage}`,
  }));
  const never = items.filter((i) => i.value == null).length;
  const same = (a: readonly [number, number] | null, b: readonly [number, number] | null) => a != null && b != null && a[0] === b[0] && a[1] === b[1];
  // A hand-drawn brush matches no preset: nothing is pressed.
  const current: Preset | "" = !k.brush ? "all" : same(k.brush, k.presets.top10) ? "top10" : same(k.brush, k.presets.over70) ? "over70" : same(k.brush, k.presets.never) ? "never" : "";
  const stageTones = k.layers.filter((l) => !l.exit && !l.retired);

  return (
    <Section
      title={t("skyTitle")}
      count={t("skyCount", { count: never })}
      // The winner's state line IS its legend: a swatch per stage, then the coral cap.
      stateMark={
        <span className="k-g-legend">
          {stageTones.map((l) => (
            <span key={l.id} className={`k-tone--${l.tone}`}><i className="k-swatch" /><span className="k-g-legend__word">{l.label}</span></span>
          ))}
          <span><i className="k-swatch is-cap" />{t("legendWaiting")}</span>
        </span>
      }
      actions={
        <Segmented
          label={t("presetsLabel")}
          value={current}
          onChange={(v) => k.setBrush(v === "all" ? null : k.presets[v as Exclude<Preset, "all">])}
          items={[
            { value: "all", label: t("presetAll") },
            { value: "top10", label: t("presetTop"), disabled: !k.presets.top10 },
            { value: "over70", label: t("presetOver"), disabled: !k.presets.over70 },
            { value: "never", label: t("presetNever"), disabled: !k.presets.never },
          ]}
        />
      }
    >
      <Skyline
        id="pipeline-skyline"
        label={t("skyLabel", { count: items.length })}
        items={items}
        brush={k.brush}
        onBrush={k.setBrush}
        onPick={(it) => k.select(it.id)}
        picked={k.open?.id ?? null}
        state={status}
        replayKey={k.skyKey}
        describe={(it) => (it.value == null ? t("neverScored") : t("matchValue", { score: it.value }))}
        brushNote={(r) => {
          const a = items[r[0]]?.value;
          const z = items[r[1]]?.value;
          return a == null ? t("neverScored") : t("brushNote", { from: a, to: z == null ? t("neverScored") : String(z) });
        }}
        emptyText={t("skyEmpty")}
      />
    </Section>
  );
}
