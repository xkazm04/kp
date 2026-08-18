"use client";

// Preview renderers — LIBRARY (Jobs, Job descriptions) and TOOLS (Archetypes,
// Analyze, Interview sim, Assignments).
import { useTranslations } from "next-intl";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { RankList, Row, Rows, Sub, Tile, Tiles, useFmt } from "./previewBits";

type V<K extends PalettePreview["view"]> = Extract<PalettePreview, { view: K }>;

export function PreviewJobs({ p }: { p: V<"jobs"> }) {
  const t = useTranslations("palettePreview.jobs");
  const { num } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("total")} value={num(p.total)} />
        <Tile label={t("draft")} value={num(p.draft)} tone={p.draft > 0 ? "coral" : "steel"} />
        <Tile label={t("entryEligible")} value={num(p.entryEligible)} tone="moss" />
      </Tiles>
      {p.families.length ? (
        <>
          <Sub>{t("families")}</Sub>
          <RankList items={p.families} />
        </>
      ) : null}
    </>
  );
}

export function PreviewLibrary({ p }: { p: V<"library"> }) {
  const t = useTranslations("palettePreview.library");
  const { num, rel } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("total")} value={num(p.total)} />
        <Tile label={t("analyzing")} value={num(p.analyzing)} tone={p.analyzing > 0 ? "coral" : "steel"} />
        <Tile label={t("failed")} value={num(p.failed)} tone={p.failed > 0 ? "coral" : "steel"} />
      </Tiles>
      <Rows>
        <Row label={t("templates")}>{num(p.templates)}</Row>
        {p.newest ? (
          <Row label={t("newest")}>
            {p.newest.title} · {rel(p.newest.createdAt)}
          </Row>
        ) : null}
      </Rows>
    </>
  );
}

export function PreviewArchetypes({ p }: { p: V<"archetypes"> }) {
  const t = useTranslations("palettePreview.archetypes");
  const { num } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("archetypes")} value={num(p.archetypes)} />
        <Tile label={t("candidates")} value={num(p.candidates)} />
      </Tiles>
      {p.top.length ? (
        <>
          <Sub>{t("top")}</Sub>
          <RankList items={p.top} />
        </>
      ) : null}
    </>
  );
}

export function PreviewAnalyze({ p }: { p: V<"analyze"> }) {
  const t = useTranslations("palettePreview.analyze");
  const { num, rel } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("analyses")} value={num(p.analyses)} />
        <Tile label={t("avgScore")} value={p.avgScore == null ? "—" : <ScoreBadge score={p.avgScore} />} />
      </Tiles>
      {p.latest ? (
        <Rows>
          <Row label={t("latest")}>
            <span className="inline-flex items-center gap-2">
              <span className="truncate">{p.latest.label}</span>
              <ScoreBadge score={p.latest.score} />
              <span className="text-steel">{rel(p.latest.createdAt)}</span>
            </span>
          </Row>
        </Rows>
      ) : null}
    </>
  );
}

export function PreviewInterview({ p }: { p: V<"interview"> }) {
  const t = useTranslations("palettePreview.interview");
  const { num, rel } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("sessions")} value={num(p.sessions)} />
        <Tile label={t("completed")} value={num(p.completed)} tone="moss" />
        <Tile label={t("live")} value={num(p.live)} tone={p.live > 0 ? "coral" : "steel"} />
      </Tiles>
      {p.latest ? (
        <Rows>
          <Row label={t("latest")}>
            {p.latest.candidate} · {p.latest.status} · {rel(p.latest.createdAt)}
          </Row>
        </Rows>
      ) : null}
    </>
  );
}

export function PreviewAssignments({ p }: { p: V<"assignments"> }) {
  const t = useTranslations("palettePreview.assignments");
  const { num } = useFmt();
  return (
    <Tiles>
      <Tile label={t("cases")} value={num(p.cases)} />
      <Tile label={t("postings")} value={num(p.postings)} />
      <Tile label={t("submissions")} value={num(p.submissions)} tone="moss" />
    </Tiles>
  );
}
