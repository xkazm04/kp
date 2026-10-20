"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataTable, Mark, Section, formatCount, type Column } from "@/app/_components/kit";
import { MiniRail, type MiniRailStep } from "@/app/_components/kit/graphic/MiniRail";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyKit } from "./useJourneyKit";
import { KIT_STEPS } from "./journeyKitSteps";
import { useStepLabel } from "./useStepLabel";

type RoleRow = JourneyKit["roleRows"][number];

/**
 * The row's mark says whether a journey in the role waits on you; the coral edge stays the lanes'
 * (one role waiting is a fact about the role, not a row to act on here).
 *
 * "Roles": every role in the workspace as one row, its reach drawn as a mini rail on the SAME steps
 * the lanes below use, so the column of rows reads as one chart. Pressing a row shows that role's
 * candidates. Windowed (DataTable) so 19 roles, or 40, sit in five calm rows with a pager.
 */
export function JourneyKitRoles({ k, onRetry }: { k: JourneyKit; onRetry: () => void }) {
  const t = useTranslations("journey");
  const tEnums = useTranslations("enums");
  const locale = useLocale();
  const { date } = useDateFormat();
  const label = useStepLabel();
  const n = (v: number) => formatCount(v, locale);
  const status = k.cohortError ? "error" : k.cohort.loading ? "loading" : "ready";
  const journeys = k.roleRows.reduce((sum, r) => sum + r.role.n, 0);

  const area = (slug: string | null) => {
    if (!slug) return t("cohort.roleUnassigned");
    const key = `family.${slug}` as Parameters<typeof tEnums>[0];
    return tEnums.has(key) ? tEnums(key) : slug;
  };
  const words = (s: MiniRailStep) => `${s.label}: ${t("rail.reached", { reached: n(s.reached), cohort: n(s.of) })}`;

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "role", label: t("kit.colRole"), track: "name", primary: true },
    { id: "reach", label: "", track: "meta" },
    { id: "journeys", label: t("kit.colJourneys"), track: "fig", numeric: true },
    { id: "last", label: t("kit.colLast"), track: "time", numeric: true },
  ];
  const cells = (r: RoleRow) => [
    r.needs ? <Mark key="m" kind="needs" tip={t("kit.rolesNeeds", { count: r.needs })} /> : <Mark key="m" kind="wait" tip={t("kit.rolesWait")} />,
    <Fragment key="name">{r.role.title}<small>{area(r.role.roleArea)}</small></Fragment>,
    <MiniRail key="reach" words={words} steps={KIT_STEPS.map((s, i) => ({ id: s, label: label(s), reached: r.reach[i], of: r.role.n }))} />,
    <Fragment key="fig">{n(r.role.n)}<span className="k-fig__of"> · {t("kit.rolesHired", { count: r.hired })}</span></Fragment>,
    r.last ? date(new Date(r.last).toISOString()) : <span className="k-absent">—</span>,
  ];

  return (
    <Section
      id="journey-kit-roles"
      title={t("kit.rolesTitle")}
      count={status === "ready" ? t("kit.rolesCount", { roles: k.roleRows.length, journeys }) : undefined}
      state={t("kit.rolesState")}
      status={status === "error" ? "error" : "ready"}
      errorText={k.cohortError ?? undefined}
      onRetry={onRetry}
    >
      <DataTable
        label={t("kit.rolesLabel")}
        rows={k.roleRows}
        columns={columns}
        cells={cells}
        rowKey={(r) => r.role.jobId}
        visibleRows={5}
        selectedKey={k.jobId}
        onSelect={k.pickRole}
        state={status === "loading" ? "loading" : "ready"}
        emptyText={t("empty")}
      />
    </Section>
  );
}
