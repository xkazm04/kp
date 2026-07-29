"use client";

// Left-hand archetype picker (active list + collapsed retired section), split out of
// ArchetypeManager.tsx.
import { Archive, ArchiveRestore, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";

export function ArchetypeManagerList({
  active,
  archived,
  selectedId,
  isCreating,
  showArchived,
  setShowArchived,
  busyArchiveId,
  onSelect,
  onUnarchive,
}: {
  active: ArchetypeDef[];
  archived: ArchetypeDef[];
  selectedId: string | undefined;
  isCreating: boolean;
  showArchived: boolean;
  setShowArchived: (updater: (v: boolean) => boolean) => void;
  busyArchiveId: string | null;
  onSelect: (id: string) => void;
  onUnarchive: (id: string) => void;
}) {
  const t = useTranslations("profile.archetypes");

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {active.map((a) => {
          const isActive = selectedId === a.id && !isCreating;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                aria-current={isActive ? "true" : undefined}
                className={`focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base font-medium transition-colors ${
                  isActive ? "bg-coral/10 text-coral" : "text-ink hover:bg-stone-50"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.fairnessProtected ? <Shield size={13} className="shrink-0 text-moss" aria-label={t("fairnessProtectedAria")} /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {archived.length ? (
        <div className="rounded-md border border-stone-200 bg-stone-50/60 p-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="focus-ring flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm font-semibold text-steel"
          >
            <Archive size={13} aria-hidden />
            {t("archivedSection", { count: archived.length })}
            <span className="ml-auto">{showArchived ? "−" : "+"}</span>
          </button>
          {showArchived ? (
            <ul className="mt-1 space-y-1">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-steel">{a.label}</span>
                  <span className="shrink-0 rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel">
                    {t("retiredMarker")}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUnarchive(a.id)}
                    disabled={busyArchiveId === a.id}
                    className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-50"
                    title={t("unarchiveTitle", { label: a.label })}
                  >
                    <ArchiveRestore size={13} /> {busyArchiveId === a.id ? t("saving") : t("unarchive")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
