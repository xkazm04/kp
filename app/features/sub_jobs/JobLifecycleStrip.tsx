"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams, type TabScopedParamKey, type WorkspaceTabId } from "@/app/features/tabs";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";

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

export function JobLifecycleStrip({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.posting.lifecycle");
  const router = useRouter();
  const search = useSearchParams();
  const [entries, setEntries] = useState<PipelineEntryLite[] | null>(null);
  const [hooks, setHooks] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (alive) setEntries(((p.entries ?? []) as PipelineEntryLite[]).filter((e) => e.jobId === jobId));
      })
      .catch(() => undefined);
    fetch("/api/channels/webhooks")
      .then((r) => r.json())
      .then((p) => {
        if (alive) {
          const list = (p.webhooks ?? []) as { jobId?: string | null }[];
          setHooks(list.filter((h) => h.jobId === jobId).length);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [jobId]);

  if (entries === null && hooks === null) return null;

  const active = (entries ?? []).filter((e) => e.status === "active");
  const decisions = active.filter((e) => e.approvalKind && e.approvalKind !== "calendar").length;
  const toSchedule = active.filter((e) => e.approvalKind === "calendar").length;
  const offersOut = active.filter((e) => e.stage === "Offer").length;
  const hired = (entries ?? []).filter((e) => e.stage === "Hired").length;
  const jdSlug = jdSlugOfJobId(jobId);

  const segs: (Seg | null)[] = [
    jdSlug ? { key: "jd", label: t("jd"), href: `/jds/${encodeURIComponent(jdSlug)}` } : null,
    hooks !== null ? { key: "channels", label: t("channels", { count: hooks }), tab: "channels" } : null,
    entries !== null
      ? { key: "funnel", label: t("funnel", { count: active.length }), tab: "pipeline", params: { q: jobTitle } }
      : null,
    decisions > 0
      ? { key: "decisions", label: t("decisions", { count: decisions }), tab: "decisions", params: { job: jobId } }
      : null,
    toSchedule > 0 ? { key: "schedule", label: t("schedule", { count: toSchedule }), tab: "schedule" } : null,
    offersOut > 0
      ? { key: "offers", label: t("offers", { count: offersOut }), tab: "pipeline", params: { q: jobTitle, stage: "Offer" } }
      : null,
    hired > 0
      ? { key: "hired", label: t("hired", { count: hired }), tab: "pipeline", params: { q: jobTitle, stage: "Hired" } }
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
