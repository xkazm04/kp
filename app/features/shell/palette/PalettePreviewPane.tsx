"use client";

// The palette's preview BODY: highlighted item → the matching renderer, with a
// skeleton while the facts load and quiet copy for the empty / restricted /
// failed cases. Sits under the PreviewCard's title in WorkspacePaletteLedger.
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import type { PaletteItem } from "../workspaceCommandPaletteTypes";
import { PreviewAnalysis, PreviewEntry, PreviewJd, PreviewJob, PreviewProfile } from "./PreviewEntities";
import { PreviewAgents, PreviewChannels, PreviewDecisions, PreviewPipeline, PreviewSchedule } from "./PreviewHiring";
import {
  PreviewAbout,
  PreviewActivity,
  PreviewAnalytics,
  PreviewBilling,
  PreviewBranding,
  PreviewHiringSettings,
  PreviewIntegrations,
  PreviewMatrix,
  PreviewModels,
  PreviewOrganization,
  PreviewWorkspace,
} from "./PreviewInsightsSettings";
import { PreviewAnalyze, PreviewArchetypes, PreviewAssignments, PreviewInterview, PreviewJobs, PreviewLibrary } from "./PreviewLibraryTools";
import { previewQuery, usePalettePreview } from "./usePalettePreview";

export function PalettePreviewPane({ item }: { item: PaletteItem }) {
  const t = useTranslations("palettePreview");
  const state = usePalettePreview(item);
  if (state.status === "idle") return null;
  // No skeleton: the fetch is ~one debounce long and the pane's title/eyebrow are
  // already on screen, so a placeholder would only flash. The facts arrive as a
  // staggered cascade instead (`.stagger-children` — house loading tier, reduced-
  // motion aware); the key re-arms it per destination.
  if (state.status === "loading") return <div aria-busy aria-label={t("loading")} />;
  if (state.status === "error") return <p className="animate-arrive-in text-sm text-steel">{t("unavailable")}</p>;
  return (
    <div key={previewQuery(item) ?? undefined} className="stagger-children space-y-3">
      {renderPreview(state.preview, t)}
    </div>
  );
}

function renderPreview(p: PalettePreview, t: ReturnType<typeof useTranslations>) {
  switch (p.view) {
    case "pipeline":
      return <PreviewPipeline p={p} />;
    case "channels":
      return <PreviewChannels p={p} />;
    case "decisions":
      return <PreviewDecisions p={p} />;
    case "schedule":
      return <PreviewSchedule p={p} />;
    case "agents":
      return <PreviewAgents p={p} />;
    case "jobs":
      return <PreviewJobs p={p} />;
    case "library":
      return <PreviewLibrary p={p} />;
    case "archetypes":
      return <PreviewArchetypes p={p} />;
    case "analyze":
      return <PreviewAnalyze p={p} />;
    case "interview":
      return <PreviewInterview p={p} />;
    case "assignments":
      return <PreviewAssignments p={p} />;
    case "analytics":
      return <PreviewAnalytics p={p} />;
    case "matrix":
      return <PreviewMatrix p={p} />;
    case "activity":
      return <PreviewActivity p={p} />;
    case "about":
      return <PreviewAbout />;
    case "organization":
      return <PreviewOrganization p={p} />;
    case "branding":
      return <PreviewBranding p={p} />;
    case "billing":
      return <PreviewBilling p={p} />;
    case "models":
      return <PreviewModels p={p} />;
    case "integrations":
      return <PreviewIntegrations p={p} />;
    case "workspace":
      return <PreviewWorkspace p={p} />;
    case "hiring":
      return <PreviewHiringSettings p={p} />;
    case "profile":
      return <PreviewProfile p={p} />;
    case "entry":
      return <PreviewEntry p={p} />;
    case "job":
      return <PreviewJob p={p} />;
    case "jd":
      return <PreviewJd p={p} />;
    case "analysis":
      return <PreviewAnalysis p={p} />;
    case "restricted":
      return (
        <p className="flex items-center gap-1.5 text-sm text-steel">
          <Lock size={14} aria-hidden /> {t("restricted")}
        </p>
      );
    case "missing":
      return <p className="text-sm text-steel">{t("missing")}</p>;
  }
}
