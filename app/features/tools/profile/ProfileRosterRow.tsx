"use client";

// Single roster row (name/archetype/completeness + Edit/Match/Delete actions), split
// out of ProfileRoster.tsx.
import { Pencil, RefreshCw, Trash2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { scoreTone } from "@/app/_lib/format";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";

export function ProfileRosterRow({
  p,
  staleInfo,
  isArchivedArchetype,
  confirming,
  busy,
  onEdit,
  onMatch,
  onRebuild,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  p: RosterProfile;
  staleInfo: StaleMap[string] | undefined;
  isArchivedArchetype: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: (id: string) => void;
  onMatch: (id: string) => void;
  onRebuild: (id: string, newerSlug: string) => void;
  onStartDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}) {
  const t = useTranslations("profile.roster");
  const enumLabel = useEnumLabel();
  const pct = Math.round((p.completeness ?? 0) * 100);

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-ink">{p.label}</span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel">
            {enumLabel("archetype", archetypeDisplayKey(p.archetype))}
          </span>
          {p.archetype && isArchivedArchetype ? (
            <span
              className="rounded-full bg-stone-200 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel"
              title={t("retiredArchetypeTitle")}
            >
              {t("retiredArchetype")}
            </span>
          ) : null}
          {p.role_family ? (
            <span className="text-sm text-steel">{enumLabel("family", p.role_family)}</span>
          ) : null}
          {staleInfo ? (
            // Neutral (amber, mapped in both themes) staleness flag: a newer
            // CV analysis exists than the one this profile was built from.
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-amber-800"
              title={t("staleTitle", { date: new Date(staleInfo.newerAnalyzedAt).toLocaleDateString() })}
            >
              <RefreshCw size={11} aria-hidden /> {t("staleBadge")}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Meter value={pct} tone={scoreTone(pct)} className="h-1.5 w-32" aria-label={t("completenessAria", { pct })} />
          <span className="text-sm text-steel">{t("completenessPct", { pct })}</span>
        </div>
      </div>

      {confirming ? (
        <span className="animate-fade-in inline-flex items-center gap-1.5" role="group" aria-label={t("deleteGroupAria", { name: p.label })}>
          <span className="text-sm font-semibold text-red-700">{t("deletePrompt")}</span>
          <button
            type="button"
            onClick={() => onConfirmDelete(p.id)}
            disabled={busy}
            className="focus-ring rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {busy ? t("deleting") : t("deleteConfirm")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onCancelDelete}
            className="focus-ring rounded-md px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-100"
          >
            {t("cancel")}
          </button>
        </span>
      ) : (
        <div className="flex items-center gap-1">
          {staleInfo ? (
            <button
              type="button"
              onClick={() => onRebuild(p.id, staleInfo.newerSlug)}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
              title={t("rebuildTitle", { name: p.label })}
            >
              <RefreshCw size={14} /> {t("rebuild")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onMatch(p.id)}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-ink hover:border-coral/40 hover:text-coral"
            title={t("matchTitle", { name: p.label })}
          >
            <Zap size={14} /> {t("match")}
          </button>
          <button
            type="button"
            onClick={() => onEdit(p.id)}
            className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100 hover:text-ink"
            title={t("editTitle", { name: p.label })}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => onStartDelete(p.id)}
            className="focus-ring rounded-md p-1.5 text-steel hover:bg-red-50 hover:text-red-700"
            title={t("deleteTitle", { name: p.label })}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </li>
  );
}
