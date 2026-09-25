"use client";

import { Fragment, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataTable, Measure, Section, formatCount, type Column, type PartState } from "@/app/_components/kit";
import { Lane, StageRail, type RailStep } from "@/app/_components/kit/graphic";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyKit } from "./useJourneyKit";
import { QUIET_DAYS, type LaneRow } from "./journeyKitModel";
import { STEP_TONE, type KitStep } from "./journeyKitSteps";
import { useLaneArrival } from "./useLaneArrival";
import { useLaneWords } from "./useLaneWords";

/** ← → walk the rail's steps (a roving move over its toggle buttons); Enter/Space press one. */
function railArrows(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const steps = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-role='kit-rail-step']:not(:disabled)"));
  const at = steps.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  steps[Math.max(0, Math.min(steps.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))]?.focus();
}

/**
 * "Candidates against the steps": the role's StageRail as the head, then one Lane per candidate on
 * the same columns, so every journey in the role is compared against one rail. A step press shows
 * who stopped there; a row opens the reading pane.
 */
export function JourneyKitLanes({ k, status, onRetry }: { k: JourneyKit; status: PartState; onRetry: () => void }) {
  const t = useTranslations("journey");
  const locale = useLocale();
  const { date } = useDateFormat();
  const { cellTip, statusMark, emptyWords, label } = useLaneWords();
  const arriving = useLaneArrival(k.replayKey, status === "ready" && k.lanes.length > 0);
  const n = (v: number) => formatCount(v, locale);
  const title = k.cluster?.title ?? "";
  const total = k.lanes.length;

  const steps: RailStep[] = k.rail.map((s) => ({
    id: s.step,
    label: label(s.step),
    reached: status === "ready" ? s.reached : null,
    of: status === "ready" ? s.of : null,
    stopped: s.stopped,
    absent: s.absent === null ? undefined : s.absent ? t(s.absent as Parameters<typeof t>[0]) : t("absence.nothingHappened"),
    tip: s.machine ? t("rail.byMachine", { count: n(s.machine) }) : undefined,
  }));

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: t("kit.colCandidate"), track: "name", primary: true },
    { id: "lane", label: "", track: "meta" },
    { id: "match", label: t("kit.colMatch"), track: "fig", numeric: true },
    { id: "last", label: t("kit.colLast"), track: "time", numeric: true },
  ];
  const cells = (l: LaneRow) => [
    statusMark(l),
    <Fragment key="name">
      {l.column.origin.kind === "test-run" ? <span className="k-gen">{l.column.candidateLabel}</span> : l.column.candidateLabel}
      <small>{l.column.stage}</small>
    </Fragment>,
    l.column.events.length ? (
      <Lane
        key="lane"
        arriving={arriving}
        cells={l.cells.map((c) => ({ shape: c.shape, tone: c.reason === "reached" ? STEP_TONE[c.step] : undefined, tip: cellTip(c) }))}
      />
    ) : (
      <span key="lane" className={emptyWords(l).reasoned ? "k-lane__none" : "jk-never"}>{emptyWords(l).text}</span>
    ),
    l.column.matchScore == null ? <span className="k-absent" data-tip={t("kit.neverScored")} tabIndex={-1}>—</span> : n(l.column.matchScore),
    l.last ? (
      <Fragment key="last">
        {date(l.last.occurredAt)}
        {l.quietDays != null && l.quietDays >= QUIET_DAYS ? <small className="jk-quiet">{t("kit.quiet", { days: l.quietDays })}</small> : null}
      </Fragment>
    ) : (
      <span className="k-absent">—</span>
    ),
  ];

  const stop = k.filters.stop;
  return (
    <Section
      id="journey-kit-lanes"
      title={t("kit.lanesTitle")}
      count={status === "ready" ? (k.rows.length === total ? n(total) : t("kit.lanesCount", { shown: k.rows.length, total })) : undefined}
      state={stop ? t("kit.lanesStateStop", { step: label(stop) }) : t("kit.lanesState")}
    >
      <div className="jk-lanes">
        <Measure className="k-table__head is-tall jk-railhead" data-role="journey-kit-railhead">
          <div className="jk-railhead__name">
            <b data-tip={t("kit.railNote")} tabIndex={0}>{t("rail.title")}</b>
          </div>
          <div className="jk-railhead__rail" onKeyDown={railArrows}>
            <StageRail
              id="journey-lanes"
              steps={steps}
              label={t("rail.forRole", { role: title })}
              selected={stop}
              onStep={(id) => k.toggleStop(id as KitStep)}
              replayKey={k.replayKey}
            />
          </div>
        </Measure>
        <DataTable
          label={t("kit.lanesLabel")}
          rows={k.rows}
          columns={columns}
          cells={cells}
          rowKey={(l) => l.column.entryId}
          rowState={(l) => (l.status === "needs" ? ["needs"] : l.status === "empty" ? ["muted"] : [])}
          visibleRows={12}
          selectedKey={k.cursor}
          onSelect={k.select}
          state={status}
          emptyText={stop ? t("kit.lanesEmptyStop") : total ? t("noMatches") : t("empty")}
          errorText={k.boardError ?? k.cohortError ?? t("loadError")}
          onRetry={onRetry}
          resetKey={k.resetKey}
        />
        {k.cluster && k.cluster.totalColumns > k.cluster.columns.length ? (
          <p className="jk-partial">{t("kit.lanesPartial", { shown: k.cluster.columns.length, total: k.cluster.totalColumns })}</p>
        ) : null}
      </div>
    </Section>
  );
}
