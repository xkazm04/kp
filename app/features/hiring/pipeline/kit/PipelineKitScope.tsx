"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, Section, type PartState } from "@/app/_components/kit";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { OUT } from "./pipelineKitModel";
import { PipelineKitRole } from "./PipelineKitRole";
import { PipelineKitSieve } from "./PipelineKitSieve";
import { PipelineKitSkyline } from "./PipelineKitSkyline";
import { PipelineKitList } from "./PipelineKitList";

/**
 * Level 2: the picked scope's pipeline, set UNDER the roles board rather than in the reading pane. The
 * pane is the candidate's (a document 448-560px wide), and a Sieve, a Skyline and a windowed list need
 * the sheet's width; under the board the row that opened it stays in view, marked, one press from any
 * other role. The scope is one role (its doors: open the job, rank, accept / reject / evaluate its new
 * arrivals) or every role at once; its Sieve, Skyline and list read that scope alone (usePipelineKit
 * `scoped`), with every list feature (facets, saved views, select mode and the bulk bar, moves, SLA).
 * Opening a scope brings it into view; a `?role=` deep link lands here.
 */
export function PipelineKitScope({ s, k, status, onEditSla }: { s: PipelineTabState; k: PipelineKit; status: PartState; onEditSla: () => void }) {
  const t = useTranslations("pipeline.kit");
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const ready = status === "ready";
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!k.role) shown.current = null;
    if (!k.role || !ready || shown.current === k.role) return;
    shown.current = k.role;
    ref.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [k.role, ready, reduced]);
  if (!k.role) return null;

  const title = k.lane ? (k.scoped[0]?.jobTitle ?? k.lane) : t("scopeEveryone");
  const layer = k.layer === OUT ? t("outLabel") : k.layers.find((l) => l.id === k.layer)?.label;
  return (
    <div ref={ref} id="pipeline-kit-scope" role="region" aria-label={t("scopeAria", { role: title })} className="pk-scope" data-role="pipeline-kit-scope">
      <Section
        title={title}
        count={t("scopeCount", { count: k.scoped.length })}
        state={layer ? t("scopeStage", { stage: layer }) : undefined}
        actions={<Button label={t("scopeBack")} icon="up" variant="ghost" size="sm" onClick={k.closeScope} />}
      >
        <PipelineKitRole s={s} k={k} />
      </Section>
      <PipelineKitSieve s={s} k={k} status={status} />
      <PipelineKitSkyline k={k} status={status} />
      <PipelineKitList s={s} k={k} status={status} onEditSla={onEditSla} />
    </div>
  );
}
