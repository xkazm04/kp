"use client";

// Read-only detail panel for the selected archetype, split out of ArchetypeManager.tsx.
import { Archive, Pencil, Shield, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";
import { SLOTS } from "./ArchetypeManagerTypes";

export function ArchetypeManagerViewPanel({
  archetype,
  onEdit,
  canArchive,
  archiving,
  onArchive,
}: {
  archetype: ArchetypeDef;
  onEdit: () => void;
  /** Custom archetypes can be retired; built-in ones are protected. */
  canArchive: boolean;
  archiving: boolean;
  onArchive: () => void;
}) {
  const t = useTranslations("profile.archetypes");
  // The scoring model was printed raw twice (the chip and the sentence below it), so
  // the panel's own edit form offered "experienced (years-based)" in the reader's
  // language while the view showed the wire value `early_career`.
  const enumLabel = useEnumLabel();
  const scoringModel = enumLabel("scoringModel", archetype.scoringModel);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-h3 text-ink">{archetype.label}</h3>
        <span className="rounded-full bg-ink px-2 py-0.5 text-sm font-semibold text-white">{archetype.badge}</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-sm text-steel">{scoringModel}</span>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm ${archetype.fairnessProtected ? "bg-moss/10 text-moss" : "bg-stone-100 text-steel"}`}>
          {archetype.fairnessProtected ? <Shield size={12} /> : <ShieldOff size={12} />}
          {archetype.fairnessProtected ? t("fairnessProtected") : t("notProtected")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {canArchive ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={archiving}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-paper hover:text-ink disabled:opacity-50"
              title={t("archiveTitle", { label: archetype.label })}
            >
              <Archive size={13} /> {archiving ? t("saving") : t("archive")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
          >
            <Pencil size={13} /> {t("edit")}
          </button>
        </div>
      </div>

      <p className="mt-1 text-sm text-steel">
        {t.rich("scoringModelLabel", { model: scoringModel, b: (chunks) => <strong className="text-ink">{chunks}</strong> })}
        {archetype.scoringModel === "early_career" ? t("earlyModelNote") : t("expModelNote")}
        {archetype.applyLabel ? t("applyClause", { label: archetype.applyLabel }) : null}
      </p>

      <div className="mt-4">
        <p className="text-meta uppercase tracking-wide text-steel">{t("scoringWeights")}</p>
        <div className="mt-2 space-y-2">
          {SLOTS.map((slot) => {
            const pct = Math.round(archetype.weights[slot] * 100);
            return (
              <div key={slot}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{archetype.dimensionLabels[slot]}</span>
                  <span className="nums text-steel">{pct}%</span>
                </div>
                <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-stone-200">
                  <div className="h-full rounded-full bg-coral" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {archetype.checklist.length ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("checklistTitle")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {archetype.checklist.map((c) => (
              <li key={c.check} className="rounded-md border border-stone-200 bg-white px-2 py-0.5 text-sm text-ink">
                {c.label} <span className="text-steel">{`·${c.weight}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
