"use client";

// Preview renderers — ENTITY hits: a candidate profile, a pipeline entry, a
// role, a saved JD, a CV analysis. The pane's title already names the entity;
// these add the facts that decide whether it is the one you meant.
import { useTranslations } from "next-intl";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Meter } from "@/app/_components/Meter";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { PipelineShapeBar } from "@/app/_components/ui/PipelineShapeBar";
import { Chips, Row, Rows, Sub, Tile, Tiles, useFmt } from "./previewBits";

type V<K extends PalettePreview["view"]> = Extract<PalettePreview, { view: K }>;

export function PreviewProfile({ p }: { p: V<"profile"> }) {
  const t = useTranslations("palettePreview.profile");
  const enumLabel = useEnumLabel();
  const { date } = useFmt();
  return (
    <>
      {/* Archetype + role family arrive as canonical slugs (`bau`,
          `software_engineering`) — the wire value the pipeline branches on. Every
          other surface displays them through the `enums` catalog (useEnumLabel);
          rendering them raw here printed the slug itself in all four locales. */}
      <Chips items={[enumLabel("archetype", p.archetype), enumLabel("family", p.roleFamily)]} />
      {p.completeness != null ? (
        // completeness is a 0–1 fraction in the store (ProfileRosterRow's convention).
        <div className="space-y-1">
          <Row label={t("completeness")}>{Math.round(p.completeness * 100)} %</Row>
          <Meter value={p.completeness * 100} tone={p.completeness >= 0.8 ? "strong" : p.completeness >= 0.5 ? "mid" : "weak"} aria-label={t("completeness")} />
        </div>
      ) : null}
      <Rows>
        <Row label={t("since")}>{date(p.createdAt)}</Row>
      </Rows>
      <Sub>{t("placements")}</Sub>
      {p.placements.length ? (
        <ul className="space-y-1 text-sm">
          {p.placements.map((pl, i) => (
            <li key={`${pl.jobTitle}-${i}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-ink">{pl.jobTitle}</span>
              <Badge tone="info" label={pl.stage} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-steel">{t("noPlacements")}</p>
      )}
    </>
  );
}

export function PreviewEntry({ p }: { p: V<"entry"> }) {
  const t = useTranslations("palettePreview.entry");
  const { rel } = useFmt();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info" label={p.stage} />
        <ScoreBadge score={p.matchScore} />
        {p.approvalKind ? <Badge tone="caution" label={p.approvalKind} /> : null}
      </div>
      {p.jobTitle ? <p className="text-sm text-steel">{p.jobTitle}</p> : null}
      <Rows>
        <Row label={t("moved")}>{rel(p.stageChangedAt)}</Row>
        {p.source ? <Row label={t("source")}>{p.source}</Row> : null}
        {p.nextInvite ? (
          <Row label={t("invite")}>
            {p.nextInvite.slot ?? p.nextInvite.status}
          </Row>
        ) : null}
      </Rows>
    </>
  );
}

const JOB_STATUS_TONE: Record<string, BadgeTone> = { published: "positive", draft: "caution", closed: "neutral" };

export function PreviewJob({ p }: { p: V<"job"> }) {
  const t = useTranslations("palettePreview.job");
  const enumLabel = useEnumLabel();
  const { num } = useFmt();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {p.status ? <Badge tone={JOB_STATUS_TONE[p.status] ?? "neutral"} label={p.status} /> : null}
        <Chips items={[p.company, p.location, enumLabel("seniority", p.seniority)]} />
      </div>
      <Sub>{t("funnel")}</Sub>
      <PipelineShapeBar label={p.title} total={p.total} reachedInterview={p.reachedInterview} hired={p.hired} peak={Math.max(1, p.total)} />
      <Tiles>
        <Tile label={t("total")} value={num(p.total)} />
        <Tile label={t("interviewed")} value={num(p.reachedInterview)} />
        <Tile label={t("hired")} value={num(p.hired)} tone="moss" />
      </Tiles>
    </>
  );
}

const BUILD_TONE: Record<string, BadgeTone> = { ready: "positive", analyzing: "info", failed: "critical" };

export function PreviewJd({ p }: { p: V<"jd"> }) {
  const t = useTranslations("palettePreview.jd");
  const { date, num } = useFmt();
  return (
    <>
      {p.analysisStatus ? <Badge tone={BUILD_TONE[p.analysisStatus] ?? "neutral"} label={p.analysisStatus} /> : null}
      <Tiles>
        <Tile label={t("analyses")} value={num(p.analyses)} />
        <Tile label={t("words")} value={num(p.words)} tone="steel" />
      </Tiles>
      <Rows>
        <Row label={t("created")}>{date(p.createdAt)}</Row>
      </Rows>
    </>
  );
}

const DISPOSITION_TONE: Record<string, BadgeTone> = { advance: "positive", hold: "caution", pass: "critical" };

export function PreviewAnalysis({ p }: { p: V<"analysis"> }) {
  const t = useTranslations("palettePreview.analysis");
  const enumLabel = useEnumLabel();
  const { date } = useFmt();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={p.score} />
        {p.disposition ? <Badge tone={DISPOSITION_TONE[p.disposition] ?? "neutral"} label={p.disposition} /> : <Badge tone="neutral" label={t("undecided")} />}
      </div>
      <Chips items={[enumLabel("family", p.roleFamily), enumLabel("seniority", p.seniority)]} />
      <Rows>
        <Row label={t("created")}>{date(p.createdAt)}</Row>
        {p.jdSlug ? <Row label={t("jd")}>{p.jdSlug}</Row> : null}
      </Rows>
    </>
  );
}
