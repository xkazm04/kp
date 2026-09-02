"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams, type TabScopedParamKey, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { DEFAULT_STAGE_AXIS, stageHasRole, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";

// c91ec8b1 — the job modal's mission-control strip: this role's lifecycle as
// live counts, each segment deep-linking to the tab that owns it. The chain it
// stitches: JD source (library detail) → channels listening → funnel on the
// board → decisions pending → slots to confirm → offers out → hired. Every
// count was already derivable, but only by visiting that tab and re-applying
// the job filter by hand — the strip answers "how is this role doing?" in one
// row. Best-effort: a failed load renders nothing (the modal's content tabs
// don't depend on it).

type Seg = {
  key: string;
  label: string;
  // Workspace tab destination with deep-link params, or a plain href (/jds/…).
  tab?: WorkspaceTabId;
  params?: Partial<Record<TabScopedParamKey, string>>;
  href?: string;
};

type PipelineEntryLite = {
  jobId: string | null;
  status: string;
  stage: string;
  approvalKind: string | null;
};

export function JobLifecycleStrip({
  jobId,
  jobTitle,
  // Bumped by the modal after every lifecycle transition (publish / close /
  // reopen). Without it the effect keyed on [jobId] alone, so the strip a
  // recruiter had just watched go live still showed the pre-publish funnel,
  // channels and decision counts until the modal was closed and reopened —
  // mission control reporting the state of the world one action ago.
  refreshToken = 0,
}: {
  jobId: string;
  jobTitle: string;
  refreshToken?: number;
}) {
  const t = useTranslations("jobs.posting.lifecycle");
  const router = useRouter();
  const search = useSearchParams();
  const [entries, setEntries] = useState<PipelineEntryLite[] | null>(null);
  const [hooks, setHooks] = useState<number | null>(null);
  // ONE THREAD — the work samples cut for this role. Until dev_cases.job_id existed the
  // JD a case was designed from lived only inside its need_json blob, so this surface
  // could not tell that a role HAD an assignment; the recruiter had to remember. Null
  // until the fetch lands (and after a failure), which keeps the segment absent rather
  // than asserting a confident "0 assignments" the strip has not actually established.
  const [assignments, setAssignments] = useState<number | null>(null);
  // The board's columns ride out WITH the entries (GET /api/pipeline answers
  // `{ entries, stages, retiredStages }`), so the strip resolves offer/terminal
  // through this workspace's OWN axis instead of the shipped names. Null until it
  // lands — the shipped axis is the fallback, never an empty one.
  const [axisStages, setAxisStages] = useState<StageDef[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/pipeline")
      .then(async (r) => {
        // A non-2xx body still parses (safeJsonError answers JSON), and `?? []`
        // would turn it into a confident "0 in funnel". Leave the counts unknown
        // so the strip stays absent, as the header promises.
        if (!r.ok) return;
        const p = (await r.json()) as { entries?: PipelineEntryLite[]; stages?: StageDef[] };
        if (!alive) return;
        setEntries((p.entries ?? []).filter((e) => e.jobId === jobId));
        if (p.stages?.length) setAxisStages(p.stages);
      })
      .catch(() => undefined);
    fetch("/api/channels/webhooks")
      .then(async (r) => {
        if (!r.ok) return;
        const p = (await r.json()) as { webhooks?: { jobId?: string | null }[] };
        if (alive) setHooks((p.webhooks ?? []).filter((h) => h.jobId === jobId).length);
      })
      .catch(() => undefined);
    // Server-filtered (the route reads dev_cases.job_id) rather than fetched-and-filtered
    // like the two above: a case payload carries its whole internal design, so the count
    // is answered by a projection instead of shipping every team's assignments to filter
    // one out of them here.
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/assignments`)
      .then(async (r) => {
        if (!r.ok) return;
        const p = (await r.json()) as { assignments?: unknown[] };
        if (alive) setAssignments((p.assignments ?? []).length);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [jobId, refreshToken]);

  if (entries === null && hooks === null && assignments === null) return null;

  const active = (entries ?? []).filter((e) => e.status === "active");
  const decisions = active.filter((e) => e.approvalKind && e.approvalKind !== "calendar").length;
  const toSchedule = active.filter((e) => e.approvalKind === "calendar").length;
  // Offers/hires are stage ROLES, not stage names: a workspace that renamed its
  // Offer column (Settings → Hiring composes the axis) counted zero of both, so
  // the two segments vanished from a role that had live offers and hires — and
  // the deep link carried an id its own board would reject.
  const axis = axisStages ?? DEFAULT_STAGE_AXIS;
  const offerStage = stageWithRole("offer", axis);
  const terminalStage = stageWithRole("terminal", axis);
  const offersOut = active.filter((e) => stageHasRole(e.stage, "offer", axis)).length;
  const hired = (entries ?? []).filter((e) => stageHasRole(e.stage, "terminal", axis)).length;
  const jdSlug = jdSlugOfJobId(jobId);

  const segs: (Seg | null)[] = [
    jdSlug ? { key: "jd", label: t("jd"), href: `/jds/${encodeURIComponent(jdSlug)}` } : null,
    // Sits between the JD and the channels because that is where it happens: the case is
    // cut FROM the JD, before the role is distributed. Rendered only when there is at
    // least one — a role with no work sample is the normal case, not a gap to nag about.
    assignments ? { key: "assignments", label: t("assignments", { count: assignments }), tab: "assignments" } : null,
    hooks !== null ? { key: "channels", label: t("channels", { count: hooks }), tab: "channels" } : null,
    entries !== null
      ? { key: "funnel", label: t("funnel", { count: active.length }), tab: "pipeline", params: { q: jobTitle } }
      : null,
    decisions > 0
      ? { key: "decisions", label: t("decisions", { count: decisions }), tab: "decisions", params: { job: jobId } }
      : null,
    toSchedule > 0 ? { key: "schedule", label: t("schedule", { count: toSchedule }), tab: "schedule" } : null,
    offersOut > 0 && offerStage
      ? { key: "offers", label: t("offers", { count: offersOut }), tab: "pipeline", params: { q: jobTitle, stage: offerStage } }
      : null,
    hired > 0 && terminalStage
      ? { key: "hired", label: t("hired", { count: hired }), tab: "pipeline", params: { q: jobTitle, stage: terminalStage } }
      : null,
  ];
  const visible = segs.filter((s): s is Seg => s !== null);
  if (visible.length === 0) return null;

  const go = (seg: Seg) => {
    if (seg.href) router.push(seg.href);
    else if (seg.tab) router.push(buildUrl({ tab: seg.tab, ...clearedTabScopedParams(), ...seg.params }, search.toString()));
  };

  return (
    <div role="group" aria-label={t("aria")} className="mb-3 flex flex-wrap items-center gap-1.5">
      {visible.map((seg) => (
        <button
          key={seg.key}
          type="button"
          onClick={() => go(seg)}
          className="focus-ring inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-sm text-steel transition-colors hover:border-coral/40 hover:text-ink"
        >
          {seg.label} <ArrowRight size={11} aria-hidden />
        </button>
      ))}
    </div>
  );
}
