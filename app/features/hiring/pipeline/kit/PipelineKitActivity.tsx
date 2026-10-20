"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataTable, Mark, Note, Section, SelectField, type Column } from "@/app/_components/kit";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { useEventVerb, useRelativeTime } from "../PipelineShared";
import type { PipelineTabState } from "../usePipelineTabState";

const WINDOW_MS = 7 * 86_400_000;

/**
 * Activity (the retired board's feed): the last SEVEN DAYS of pipeline events, newest first, with the
 * candidate's full name (the operator-gated /api/pipeline/events/recent), a filter by event kind, and a
 * row that opens the entry's candidate record. A failed events read says so rather than reading as a
 * quiet week. History, not the day's work: it sits last on the page, five rows tall, windowed.
 */
export function PipelineKitActivity({ s }: { s: PipelineTabState }) {
  const tt = useTranslations("pipeline.tab");
  const t = useTranslations("pipeline.kit");
  const locale = useLocale();
  const verb = useEventVerb();
  const ago = useRelativeTime();
  const [kind, setKind] = useState("");
  // The window's floor, fixed at mount (a lazy initializer is the one place the clock may be read).
  const [from] = useState(() => new Date(Date.now() - WINDOW_MS).toISOString());
  const recent = useMemo(() => s.events.filter((ev) => ev.createdAt >= from), [s.events, from]);
  const kinds = useMemo(() => {
    const first = new Map<string, PipelineEvent>();
    for (const ev of recent) if (!first.has(ev.kind)) first.set(ev.kind, ev);
    return [...first].map(([value, ev]) => ({ value, label: verb({ ...ev, detail: null }) })).sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [recent, verb, locale]);
  const picked = kinds.some((o) => o.value === kind) ? kind : "";
  const rows = picked ? recent.filter((ev) => ev.kind === picked) : recent;
  if (!s.eventsError && !recent.length) return null;

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "who", label: t("colCandidate"), track: "name", primary: true },
    { id: "what", label: t("activityWhat"), track: "meta" },
    { id: "when", label: t("activityWhen"), track: "time", numeric: true },
  ];
  const cells = (ev: PipelineEvent) => [
    <Mark key="mark" kind="nobody" tip={t("actorUnknown")} />,
    <Fragment key="who">{ev.candidateLabel ?? tt("candidateFallback")}<small>{ev.jobTitle ?? t("noRole")}</small></Fragment>,
    verb(ev),
    ago(ev.createdAt),
  ];

  return (
    <Section
      title={tt("activity")}
      count={rows.length}
      state={tt("activityWindow")}
      actions={
        kinds.length > 1 ? (
          <SelectField label={tt("activityKindLabel")} size="sm" value={picked} onChange={setKind} options={[{ value: "", label: tt("activityAllKinds") }, ...kinds]} />
        ) : null
      }
    >
      {s.eventsError ? <Note tone="caution">{s.eventsError}</Note> : null}
      {rows.length ? (
        <DataTable
          label={tt("activity")}
          rows={rows}
          columns={columns}
          cells={cells}
          rowKey={(ev) => String(ev.id)}
          visibleRows={5}
          onSelect={(id) => {
            const ev = rows.find((r) => String(r.id) === id);
            if (ev?.entryId) void s.openEntryById(ev.entryId);
          }}
          emptyText={tt("activityAllKinds")}
          resetKey={picked}
        />
      ) : null}
    </Section>
  );
}
