"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { BUILT_IN_ARCHETYPE_IDS, type ArchetypeDef } from "@/app/features/shared/profileTypes";
import { ArchetypeManagerList } from "./ArchetypeManagerList";
import { ArchetypeManagerViewPanel } from "./ArchetypeManagerViewPanel";
import { ArchetypeManagerEditPanel } from "./ArchetypeManagerEditPanel";
import { useArchetypeManagerActions } from "./useArchetypeManagerActions";
import { SLOTS, type Draft } from "./ArchetypeManagerTypes";

const BUILT_IN = new Set<string>(BUILT_IN_ARCHETYPE_IDS);

function toDraft(a: ArchetypeDef): Draft {
  return {
    id: a.id,
    label: a.label,
    badge: a.badge,
    applyLabel: a.applyLabel ?? "",
    scoringModel: a.scoringModel,
    fairnessProtected: a.fairnessProtected,
    pct: {
      skills: Math.round(a.weights.skills * 100),
      career: Math.round(a.weights.career * 100),
      personal: Math.round(a.weights.personal * 100),
    },
    dim: { ...a.dimensionLabels },
  };
}

const BLANK_DRAFT: Draft = {
  id: "",
  label: "",
  badge: "",
  applyLabel: "",
  scoringModel: "experienced",
  fairnessProtected: false,
  pct: { skills: 50, career: 35, personal: 15 },
  dim: { skills: "Skills", career: "Career", personal: "Personal" },
};

export function ArchetypeManager({
  archetypes,
  loading,
  onChanged,
}: {
  archetypes: ArchetypeDef[];
  loading: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("profile.archetypes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [showArchived, setShowArchived] = useState(false);

  // Active vs retired: retired archetypes leave the pickers (this left list) and move to
  // a collapsed section below; the entry stays in the registry so profiles routed to it
  // still score. The main panel only ever inspects an ACTIVE archetype.
  const active = useMemo(() => archetypes.filter((a) => !a.archived), [archetypes]);
  const archived = useMemo(() => archetypes.filter((a) => a.archived), [archetypes]);

  // Default-select the first ACTIVE archetype once loaded (view mode).
  const selected = useMemo(() => {
    if (!active.length) return null;
    return active.find((a) => a.id === selectedId) ?? active[0];
  }, [active, selectedId]);

  const { saving, error, setError, busyArchiveId, setArchived, save: saveDraft } = useArchetypeManagerActions({
    // next-intl's namespace-narrowed translator type has multiple call signatures that
    // don't structurally match the hook's intentionally loose (key, params) => string
    // shape — the hook only ever calls it that way, so this narrowing is safe.
    t: t as unknown as Parameters<typeof useArchetypeManagerActions>[0]["t"],
    selectedId,
    setSelectedId,
    setMode,
    onChanged,
  });

  const pctSum = SLOTS.reduce((n, s) => n + (Number(draft.pct[s]) || 0), 0);
  const sumError = pctSum !== 100 ? t("weightsSumError", { pct: pctSum }) : null;

  const startEdit = () => {
    if (!selected) return;
    setDraft(toDraft(selected));
    setError(null);
    setMode("edit");
  };
  const startCreate = () => {
    setDraft(BLANK_DRAFT);
    setError(null);
    setMode("create");
  };
  const cancel = () => {
    setMode("view");
    setError(null);
  };

  const save = () => void saveDraft(mode === "create" ? "create" : "edit", draft, sumError, selected?.id);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-paper"
        >
          <Plus size={15} /> {t("newArchetype")}
        </button>
      </header>

      {loading ? (
        // Tier 2 (docs/LOADING_CHOREOGRAPHY.md): first-load gap only — `loading`
        // (the parent's archLoading) settles false once and stays false, so a
        // later onChanged refresh never re-shows this and never blanks the panel.
        <div className="mt-4 h-40 reveal-quiet" aria-hidden />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[14rem_1fr] animate-arrive-in">
          {/* Left: archetype list (active) + collapsed retired section */}
          <ArchetypeManagerList
            active={active}
            archived={archived}
            selectedId={selected?.id}
            isCreating={mode === "create"}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            busyArchiveId={busyArchiveId}
            onSelect={(id) => {
              setSelectedId(id);
              setMode("view");
            }}
            onUnarchive={(id) => void setArchived(id, false)}
          />

          {/* Right: detail / edit / create panel */}
          <div className="min-w-0 rounded-lg border border-stone-200 bg-paper/40 p-4">
            {mode === "view" && selected ? (
              <ArchetypeManagerViewPanel
                archetype={selected}
                onEdit={startEdit}
                canArchive={!BUILT_IN.has(selected.id)}
                archiving={busyArchiveId === selected.id}
                onArchive={() => void setArchived(selected.id, true)}
              />
            ) : (
              <ArchetypeManagerEditPanel
                mode={mode === "create" ? "create" : "edit"}
                draft={draft}
                setDraft={setDraft}
                pctSum={pctSum}
                sumError={sumError}
                saving={saving}
                error={error}
                onSave={save}
                onCancel={cancel}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
