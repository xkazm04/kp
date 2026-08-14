"use client";

// The Backup & restore panel's explanation, drawn instead of written.
//
// It used to be a four-line paragraph that had to carry five separate facts at
// once (what a dump contains, what it excludes, which direction is destructive,
// that restore replaces the whole database, and that multi-workspace refuses
// it). Nobody reads that before clicking, and by the time it matters they are
// already in the confirm dialog. The mechanism is a two-lane diagram instead:
// each lane shows the actual chain of artefacts the button walks, so the shape
// of the operation is legible before any prose is read, and the destructive lane
// LOOKS different (coral terminal node) rather than merely saying so. The one
// remaining sentence per lane is the thing a diagram genuinely cannot say.
//
// Same principle as SetupGettingStartedNextMove: give the reader a subject they
// can see before they read, and let the layout carry the ranking.
import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Database, FileJson, ListChecks } from "lucide-react";
import { META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";

type NodeTone = "neutral" | "danger";

/** One artefact in a lane: a framed glyph with its name under it. */
function FlowNode({ icon: Icon, label, tone = "neutral" }: { icon: ComponentType<{ size?: number; className?: string }>; label: string; tone?: NodeTone }) {
  const frame =
    tone === "danger"
      ? "border-coral/40 bg-coral/5 text-coral"
      : "border-stone-200 bg-white text-steel dark:border-stone-300";
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <span aria-hidden className={`inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${frame}`}>
        <Icon size={16} />
      </span>
      <span className={`text-sm ${tone === "danger" ? "font-semibold text-coral" : "text-steel"}`}>{label}</span>
    </div>
  );
}

function Arrow() {
  return <ArrowRight size={14} className="mt-2 shrink-0 text-stone-300" aria-hidden />;
}

/** One direction of the mechanism: a title, the artefact chain, one caveat line. */
function Lane({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className={`${PANEL_SUNKEN} flex flex-1 flex-col gap-2 p-3`}>
      <p className={META_LABEL}>{title}</p>
      <div className="flex items-start justify-center gap-2">{children}</div>
      <p className="text-sm text-steel">{note}</p>
    </div>
  );
}

export function OrganizationBackupFlow({ confirmWord }: { confirmWord: string }) {
  const t = useTranslations("workspaceAdmin.org.backup");
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Lane title={t("flowExport")} note={t("exportNote")}>
          <FlowNode icon={Database} label={t("flowExportA")} />
          <Arrow />
          <FlowNode icon={FileJson} label={t("flowExportB")} />
        </Lane>
        <Lane title={t("flowRestore")} note={t("restoreNote", { word: confirmWord })}>
          <FlowNode icon={FileJson} label={t("flowRestoreA")} />
          <Arrow />
          <FlowNode icon={ListChecks} label={t("flowRestoreB")} />
          <Arrow />
          {/* The destructive terminal node is coral: the lane reads as dangerous
              before the caption under it is read. */}
          <FlowNode icon={Database} label={t("flowRestoreC")} tone="danger" />
        </Lane>
      </div>
      {/* The three scope facts the paragraph used to bury mid-sentence. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-steel">
        <li>{t("scopeAll")}</li>
        <li>{t("scopeExcluded")}</li>
        <li>{t("scopeSingle")}</li>
      </ul>
    </div>
  );
}
