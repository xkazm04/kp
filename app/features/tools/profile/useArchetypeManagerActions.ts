// Archive/unarchive + save network calls split out of ArchetypeManager.tsx.
import { useState } from "react";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";
import type { Draft } from "./ArchetypeManagerTypes";

// Loosely typed translator: this hook only ever calls `t` with a plain string key and
// an optional params record, so it doesn't need (and shouldn't fight) next-intl's
// namespace-narrowed key/params overloads the way the component's own `t` is typed.
type Translator = {
  (key: string, params?: Record<string, string | number>): string;
  has(key: string): boolean;
};

export function useArchetypeManagerActions(args: {
  t: Translator;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setMode: (mode: "view" | "edit" | "create") => void;
  onChanged: () => void;
}) {
  const { t, selectedId, setSelectedId, setMode, onChanged } = args;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyArchiveId, setBusyArchiveId] = useState<string | null>(null);

  // Localize a structured registry error by its `code` (labelOr id→label pattern),
  // falling back to the server's English `error` message then a generic status.
  const validationLabel = (data: { code?: string; error?: string; params?: Record<string, string | number> }, status: number) => {
    const key = data.code ? (`validation.${data.code}` as Parameters<typeof t>[0]) : null;
    if (key && t.has(key)) return t(key, data.params);
    return data.error ?? t("saveFailedStatus", { status });
  };

  const setArchived = async (id: string, next: boolean) => {
    if (busyArchiveId) return;
    setBusyArchiveId(id);
    setError(null);
    try {
      const r = await fetch(`/api/archetypes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: next }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(validationLabel(data, r.status));
      // Retiring the inspected archetype: drop the selection so it falls back to the
      // first remaining active one instead of showing a now-hidden panel.
      if (next && selectedId === id) setSelectedId(null);
      setMode("view");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      setBusyArchiveId(null);
    }
  };

  const save = async (mode: "edit" | "create", draft: Draft, sumError: string | null, selectedArchetypeId?: string) => {
    if (sumError) {
      setError(sumError);
      return;
    }
    if (!draft.label.trim()) {
      setError(t("labelRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      id: draft.id.trim().toLowerCase(),
      label: draft.label.trim(),
      badge: draft.badge.trim() || draft.label.trim(),
      applyLabel: draft.applyLabel.trim() || undefined,
      scoringModel: draft.scoringModel,
      fairnessProtected: draft.fairnessProtected,
      weights: { skills: draft.pct.skills / 100, career: draft.pct.career / 100, personal: draft.pct.personal / 100 },
      dimensionLabels: { ...draft.dim },
    };
    try {
      const isCreate = mode === "create";
      const r = await fetch(isCreate ? "/api/archetypes" : `/api/archetypes/${encodeURIComponent(selectedArchetypeId!)}`, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(validationLabel(data, r.status));
      setSelectedId((data.archetype?.id as string | undefined) ?? null);
      setMode("view");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return { saving, error, setError, busyArchiveId, setArchived, save };
}

export type { ArchetypeDef };
