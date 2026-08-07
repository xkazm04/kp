"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { OnboardingEmptyFirstDay } from "./OnboardingEmptyFirstDay";
import { OnboardingEmptyRecord } from "./OnboardingEmptyRecord";
import { OnboardingReadyList } from "./OnboardingReadyList";
import { OnboardingRunsList } from "./OnboardingRunsList";
import { OnboardingTemplatesSection } from "./OnboardingTemplatesSection";
import type { HiredCandidate, RunSummary, Template } from "./onboardingTabTypes";

// Tier 3 (docs/design/loading-choreography.md): both are click-triggered secondary
// surfaces (a new-template editor opened from a button, a run's detail "page"
// opened by clicking a row) — neither belongs in this tab's first payload, so
// each gets its own chunk. The chunk gap is a quiet reserved box, never a spinner.
const TemplateManager = dynamic(() => import("./OnboardingTemplateManager").then((m) => ({ default: m.TemplateManager })), {
  loading: () => <div className="reveal-quiet min-h-[18rem]" aria-hidden />,
});
const RunDetailView = dynamic(() => import("./OnboardingRunDetailView").then((m) => ({ default: m.RunDetailView })), {
  loading: () => <div className="reveal-quiet min-h-[28rem]" aria-hidden />,
});

// ── Prototype scaffold (throwaway) ────────────────────────────────────────────
// Two directional treatments of the tab's FIRST-RUN state (no onboarding run has
// ever been started), switchable in place. The baseline is the default so a
// normal load is unchanged.
type EmptyVariant = "baseline" | "firstday" | "record";

const EMPTY_VARIANTS: { value: EmptyVariant; label: string }[] = [
  { value: "baseline", label: "Baseline" },
  { value: "firstday", label: "First-day plan" },
  { value: "record", label: "Hand-off record" },
];

export function OnboardingTab() {
  const [emptyVariant, setEmptyVariant] = useState<EmptyVariant>("baseline");
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-meta uppercase text-steel">Empty state</span>
        <SegmentedControl
          label="Onboarding empty-state variant"
          options={EMPTY_VARIANTS}
          value={emptyVariant}
          onChange={setEmptyVariant}
        />
      </div>
      <OnboardingTabBody emptyVariant={emptyVariant} />
    </div>
  );
}

function OnboardingTabBody({ emptyVariant }: { emptyVariant: EmptyVariant }) {
  const t = useTranslations("onboarding");
  const [hired, setHired] = useState<HiredCandidate[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyData = useCallback((p: { hired?: HiredCandidate[]; runs?: RunSummary[]; templates?: Template[] }) => {
    setHired(p.hired ?? []);
    setRuns(p.runs ?? []);
    const tpls = p.templates ?? [];
    setTemplates(tpls);
    setTemplateId((cur) => cur || tpls[0]?.id || "");
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    const r = await fetch("/api/onboarding");
    applyData(await r.json());
  }, [applyData]);

  // Mount load inlined as an async IIFE (setState lands after the await — the
  // allowed effect shape); `reload` covers the handler re-fetches.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch("/api/onboarding");
      const p = await r.json();
      if (!live) return;
      applyData(p);
    })();
    return () => {
      live = false;
    };
  }, [applyData]);

  const start = async (entryId: string) => {
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, templateId: templateId || undefined }),
    });
    const p = await r.json();
    await reload();
    if (p.run?.id) setSelected(p.run.id);
  };

  if (selected) {
    return <RunDetailView runId={selected} onBack={() => { setSelected(null); void reload(); }} />;
  }

  const toOnboard = hired.filter((h) => !h.runId);

  return (
    // Tier 1: header is chrome — renders with no data. The ready/runs region and
    // the templates section are the tab's two direct stagger children; each holds
    // its own Tier-2 swap (quiet placeholder → arrive-in content) so a refresh
    // never blanks what's already on screen. aria-busy covers the first load only
    // (loading only ever flips true→false — see the load callback above).
    <div className="mx-auto max-w-3xl stagger-children space-y-8" aria-busy={loading}>
      <header>
        <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
        <p className="mt-1 text-base text-steel">{t("intro")}</p>
      </header>

      <div>
        {loading ? (
          // Tier 2: neither the hired-to-onboard list nor the runs list exist yet.
          // Hold their combined height, invisibly, so a fast response paints nothing.
          <div className="reveal-quiet min-h-[22rem]" aria-hidden />
        ) : emptyVariant !== "baseline" && runs.length === 0 ? (
          <div className="animate-arrive-in">
            {emptyVariant === "firstday" ? (
              <OnboardingEmptyFirstDay
                hired={toOnboard}
                templates={templates}
                templateId={templateId}
                onTemplateChange={setTemplateId}
                onStart={(entryId) => void start(entryId)}
              />
            ) : (
              <OnboardingEmptyRecord
                hired={toOnboard}
                templates={templates}
                templateId={templateId}
                onTemplateChange={setTemplateId}
                onStart={(entryId) => void start(entryId)}
              />
            )}
          </div>
        ) : (
          <div className="animate-arrive-in space-y-8">
            <OnboardingReadyList
              toOnboard={toOnboard}
              templates={templates}
              templateId={templateId}
              onTemplateChange={setTemplateId}
              onStart={(entryId) => void start(entryId)}
            />
            <OnboardingRunsList runs={runs} onSelect={setSelected} />
          </div>
        )}
      </div>

      <OnboardingTemplatesSection
        templates={templates}
        loading={loading}
        newOpen={newOpen}
        onOpenNew={() => setNewOpen(true)}
        onCancelNew={() => setNewOpen(false)}
        onSavedNew={(id) => {
          setNewOpen(false);
          void reload().then(() => setTemplateId(id));
        }}
        TemplateManager={TemplateManager}
      />
    </div>
  );
}
