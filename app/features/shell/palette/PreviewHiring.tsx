"use client";

// Preview renderers — the HIRING section. Each takes its own union member and
// composes previewBits; the numbers a recruiter would glance at before opening.
import { CalendarCheck, CalendarX, Radio, RadioTower, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import { Row, Rows, Status, Sub, Tile, Tiles, useFmt } from "./previewBits";

type V<K extends PalettePreview["view"]> = Extract<PalettePreview, { view: K }>;

const STAGE_TONES = ["bg-coral", "bg-steel", "bg-moss", "bg-limewash", "bg-stone-300", "bg-coral/60", "bg-steel/60", "bg-moss/60"];

export function PreviewPipeline({ p }: { p: V<"pipeline"> }) {
  const t = useTranslations("palettePreview.pipeline");
  const { num } = useFmt();
  const total = Math.max(1, p.stages.reduce((a, s) => a + s.count, 0));
  return (
    <>
      <Tiles>
        <Tile label={t("active")} value={num(p.active)} />
        <Tile label={t("aging")} value={num(p.aging)} tone={p.aging > 0 ? "coral" : "steel"} />
        <Tile label={t("hired")} value={num(p.hired)} tone="moss" />
      </Tiles>
      <Sub>{t("byStage")}</Sub>
      {/* One stacked bar: the board's shape at a glance, then the legend. */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-stone-100" aria-hidden>
        {p.stages.map((s, i) =>
          s.count > 0 ? <span key={s.id} className={`${STAGE_TONES[i % STAGE_TONES.length]} h-full`} style={{ width: `${(s.count / total) * 100}%` }} /> : null
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
        {p.stages.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_TONES[i % STAGE_TONES.length]}`} aria-hidden />
              <span className="truncate text-steel">{s.label}</span>
            </span>
            <span className="nums text-ink">{s.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PreviewChannels({ p }: { p: V<"channels"> }) {
  const t = useTranslations("palettePreview.channels");
  const { num, rel } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("receivers")} value={num(p.receivers)} />
        <Tile label={t("accepted")} value={num(p.accepted)} tone="moss" />
        <Tile label={t("fresh")} value={num(p.fresh)} tone={p.fresh > 0 ? "coral" : "steel"} />
      </Tiles>
      <Rows>
        <Row label={t("lastReceived")}>{p.lastReceivedAt ? rel(p.lastReceivedAt) : t("never")}</Row>
      </Rows>
      <Status icon={p.relayConfigured ? RadioTower : Radio} tone={p.relayConfigured ? "positive" : "neutral"} label={p.relayConfigured ? t("relayOn") : t("relayOff")} />
    </>
  );
}

export function PreviewDecisions({ p }: { p: V<"decisions"> }) {
  const t = useTranslations("palettePreview.decisions");
  const { num } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("pending")} value={num(p.pending)} tone={p.pending > 0 ? "coral" : "steel"} />
        <Tile label={t("sealed")} value={num(p.sealed)} />
      </Tiles>
      {p.chain ? (
        <Status
          icon={p.chain.ok ? ShieldCheck : ShieldAlert}
          tone={p.chain.ok ? "positive" : "critical"}
          label={p.chain.ok ? t("chainOk", { count: p.chain.count }) : t("chainBroken")}
        />
      ) : null}
    </>
  );
}

export function PreviewSchedule({ p }: { p: V<"schedule"> }) {
  const t = useTranslations("palettePreview.schedule");
  const { num, dateTime } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("confirmed")} value={num(p.confirmed)} tone="moss" />
        <Tile label={t("awaiting")} value={num(p.awaiting)} />
        <Tile label={t("needsMoreSlots")} value={num(p.needsMoreSlots)} tone={p.needsMoreSlots > 0 ? "coral" : "steel"} />
      </Tiles>
      {p.next ? (
        <Rows>
          <Row label={t("next")}>
            {dateTime(p.next.at)}
            {p.next.candidate ? ` · ${p.next.candidate}` : ""}
          </Row>
        </Rows>
      ) : null}
      <Status
        icon={p.calendarConnected ? CalendarCheck : CalendarX}
        tone={p.calendarConnected ? "positive" : "neutral"}
        label={p.calendarConnected ? t("calendarOn") : t("calendarOff")}
      />
    </>
  );
}

export function PreviewAgents({ p }: { p: V<"agents"> }) {
  const t = useTranslations("palettePreview.agents");
  const { num, pct, usd } = useFmt();
  return (
    <>
      <Tiles>
        <Tile label={t("agents")} value={num(p.agents)} />
        <Tile label={t("runs")} value={num(p.runs)} />
        <Tile label={t("successRate")} value={p.successRate == null ? "—" : pct(p.successRate)} tone={p.successRate != null && p.successRate >= 0.8 ? "moss" : "ink"} />
      </Tiles>
      <Rows>
        <Row label={t("monthCost")}>{usd(p.monthCostUsd)}</Row>
      </Rows>
    </>
  );
}
