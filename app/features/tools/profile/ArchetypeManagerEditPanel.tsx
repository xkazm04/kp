"use client";

// Create/edit form for an archetype, split out of ArchetypeManager.tsx.
import { useTranslations } from "next-intl";
import { Input, Select, Check, Field } from "./ProfileFields";
import { SLOTS, type Draft, type Slot } from "./ArchetypeManagerTypes";

export function ArchetypeManagerEditPanel({
  mode,
  draft,
  setDraft,
  pctSum,
  sumError,
  saving,
  error,
  onSave,
  onCancel,
}: {
  mode: "edit" | "create";
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  pctSum: number;
  sumError: string | null;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("profile.archetypes");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setPct = (slot: Slot, value: number) => setDraft((d) => ({ ...d, pct: { ...d.pct, [slot]: value } }));
  const setDim = (slot: Slot, value: string) => setDraft((d) => ({ ...d, dim: { ...d.dim, [slot]: value } }));

  return (
    <div>
      <h3 className="font-serif text-h3 text-ink">{mode === "create" ? t("newArchetype") : t("editArchetype", { label: draft.label || t("archetypeFallback") })}</h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {mode === "create" ? (
          <Field label={t("idLabel")}>
            <Input value={draft.id} onChange={(e) => set("id", e.target.value)} placeholder={t("idPlaceholder")} className="w-full text-ink" />
          </Field>
        ) : null}
        <Field label={t("labelField")}>
          <Input value={draft.label} onChange={(e) => set("label", e.target.value)} className="w-full text-ink" />
        </Field>
        <Field label={t("badgeField")}>
          <Input value={draft.badge} onChange={(e) => set("badge", e.target.value)} className="w-full text-ink" />
        </Field>
        <Field label={t("scoringModelField")}>
          <Select
            value={draft.scoringModel}
            onChange={(v) => set("scoringModel", v)}
            ariaLabel={t("scoringModelField")}
            className="w-full"
            options={[
              { value: "experienced", label: t("scoringExperienced") },
              { value: "early_career", label: t("scoringEarlyCareer") },
            ]}
          />
        </Field>
        <Field label={t("applyField")}>
          <Input value={draft.applyLabel} onChange={(e) => set("applyLabel", e.target.value)} placeholder={t("applyPlaceholder")} className="w-full text-ink" />
        </Field>
      </div>

      <Check
        className="mt-3"
        label={t("fairnessCheck")}
        checked={draft.fairnessProtected}
        onChange={(v) => set("fairnessProtected", v)}
      />

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-meta uppercase tracking-wide text-steel">{t("scoringWeightsTotal")}</p>
          <span className={`text-sm font-semibold ${pctSum === 100 ? "text-moss" : "text-coral"}`}>{pctSum}%</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SLOTS.map((slot) => (
            <Field key={slot} label={t("weightFieldLabel", { slot })}>
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.pct[slot]}
                onChange={(e) => setPct(slot, Number(e.target.value))}
                className="w-full text-ink"
              />
            </Field>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SLOTS.map((slot) => (
            <Field key={slot} label={t("dimFieldLabel", { slot })}>
              <Input value={draft.dim[slot]} onChange={(e) => setDim(slot, e.target.value)} className="w-full text-ink" />
            </Field>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700" role="alert">{error}</p> : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || Boolean(sumError)}
          className="focus-ring h-9 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
        >
          {saving ? t("saving") : mode === "create" ? t("createArchetype") : t("saveChanges")}
        </button>
        <button type="button" onClick={onCancel} className="focus-ring h-9 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
