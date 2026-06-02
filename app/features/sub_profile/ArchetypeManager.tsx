"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Shield, ShieldOff } from "lucide-react";
import type { ArchetypeDef } from "./ProfileTypes";

type Slot = "skills" | "career" | "personal";
const SLOTS: Slot[] = ["skills", "career", "personal"];

type Draft = {
  id: string;
  label: string;
  badge: string;
  applyLabel: string;
  scoringModel: string;
  fairnessProtected: boolean;
  pct: Record<Slot, number>; // weights as whole-number percentages
  dim: Record<Slot, string>;
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default-select the first archetype once loaded (view mode).
  const selected = useMemo(() => {
    if (!archetypes.length) return null;
    return archetypes.find((a) => a.id === selectedId) ?? archetypes[0];
  }, [archetypes, selectedId]);

  const pctSum = SLOTS.reduce((n, s) => n + (Number(draft.pct[s]) || 0), 0);
  const sumError = pctSum !== 100 ? `Weights must total 100% (currently ${pctSum}%).` : null;

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

  const save = async () => {
    if (sumError) {
      setError(sumError);
      return;
    }
    if (!draft.label.trim()) {
      setError("Label is required.");
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
      const r = await fetch(isCreate ? "/api/archetypes" : `/api/archetypes/${encodeURIComponent(selected!.id)}`, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Save failed (${r.status}).`);
      setSelectedId(data.archetype?.id ?? null);
      setMode("view");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-meta uppercase text-coral">Workspace</p>
          <h2 className="mt-1 font-serif text-display text-ink">Archetypes</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            The candidate taxonomy that drives intake, scoring weights, the fairness shield, and how every candidate is
            ranked. Select one to inspect it; edit its weights, labels, and protections — changes apply to matching and
            intake immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-paper"
        >
          <Plus size={15} /> New archetype
        </button>
      </header>

      {loading ? (
        <div className="mt-4 h-40 animate-pulse rounded-lg bg-stone-100" aria-hidden />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
          {/* Left: archetype list */}
          <ul className="space-y-1">
            {archetypes.map((a) => {
              const active = selected?.id === a.id && mode !== "create";
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(a.id);
                      setMode("view");
                    }}
                    aria-current={active ? "true" : undefined}
                    className={`focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base font-medium transition-colors ${
                      active ? "bg-coral/10 text-coral" : "text-ink hover:bg-stone-50"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.fairnessProtected ? <Shield size={13} className="shrink-0 text-moss" aria-label="Fairness-protected" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Right: detail / edit / create panel */}
          <div className="min-w-0 rounded-lg border border-stone-200 bg-paper/40 p-4">
            {mode === "view" && selected ? (
              <ViewPanel archetype={selected} onEdit={startEdit} />
            ) : (
              <EditPanel
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

function ViewPanel({ archetype, onEdit }: { archetype: ArchetypeDef; onEdit: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-h3 text-ink">{archetype.label}</h3>
        <span className="rounded-full bg-ink px-2 py-0.5 text-sm font-semibold text-white">{archetype.badge}</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-sm text-steel">{archetype.scoringModel}</span>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm ${archetype.fairnessProtected ? "bg-moss/10 text-moss" : "bg-stone-100 text-steel"}`}>
          {archetype.fairnessProtected ? <Shield size={12} /> : <ShieldOff size={12} />}
          {archetype.fairnessProtected ? "Fairness-protected" : "Not protected"}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
        >
          <Pencil size={13} /> Edit
        </button>
      </div>

      <p className="mt-1 text-sm text-steel">
        Scoring model <strong className="text-ink">{archetype.scoringModel}</strong>
        {archetype.scoringModel === "early_career" ? " — potential replaces years of experience." : " — years/seniority drive the fit."}
        {archetype.applyLabel ? <> · Apply self-declaration: “{archetype.applyLabel}”.</> : null}
      </p>

      <div className="mt-4">
        <p className="text-meta uppercase tracking-wide text-steel">Scoring weights</p>
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
          <p className="text-meta uppercase tracking-wide text-steel">Completeness checklist (specific)</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {archetype.checklist.map((c) => (
              <li key={c.check} className="rounded-md border border-stone-200 bg-white px-2 py-0.5 text-sm text-ink">
                {c.label} <span className="text-steel">·{c.weight}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EditPanel({
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
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setPct = (slot: Slot, value: number) => setDraft((d) => ({ ...d, pct: { ...d.pct, [slot]: value } }));
  const setDim = (slot: Slot, value: string) => setDraft((d) => ({ ...d, dim: { ...d.dim, [slot]: value } }));

  return (
    <div>
      <h3 className="font-serif text-h3 text-ink">{mode === "create" ? "New archetype" : `Edit ${draft.label || "archetype"}`}</h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {mode === "create" ? (
          <Field label="Id (immutable)">
            <input
              value={draft.id}
              onChange={(e) => set("id", e.target.value)}
              placeholder="e.g. returner"
              className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring"
            />
          </Field>
        ) : null}
        <Field label="Label">
          <input value={draft.label} onChange={(e) => set("label", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring" />
        </Field>
        <Field label="Badge (short)">
          <input value={draft.badge} onChange={(e) => set("badge", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring" />
        </Field>
        <Field label="Scoring model">
          <select value={draft.scoringModel} onChange={(e) => set("scoringModel", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-2 text-base text-ink focus-ring">
            <option value="experienced">experienced (years-based)</option>
            <option value="early_career">early_career (potential-based)</option>
          </select>
        </Field>
        <Field label="Apply self-declaration (optional)">
          <input value={draft.applyLabel} onChange={(e) => set("applyLabel", e.target.value)} placeholder="shown in the apply chat" className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring" />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-base text-ink">
        <input type="checkbox" checked={draft.fairnessProtected} onChange={(e) => set("fairnessProtected", e.target.checked)} className="h-4 w-4 accent-coral" />
        Fairness-protected (never auto-rejected)
      </label>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-meta uppercase tracking-wide text-steel">Scoring weights (must total 100%)</p>
          <span className={`text-sm font-semibold ${pctSum === 100 ? "text-moss" : "text-coral"}`}>{pctSum}%</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SLOTS.map((slot) => (
            <Field key={slot} label={`${slot} weight %`}>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.pct[slot]}
                onChange={(e) => setPct(slot, Number(e.target.value))}
                className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring"
              />
            </Field>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SLOTS.map((slot) => (
            <Field key={slot} label={`${slot} label`}>
              <input value={draft.dim[slot]} onChange={(e) => setDim(slot, e.target.value)} className="h-9 w-full rounded-md border border-stone-200 px-2 text-base text-ink focus-ring" />
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
          {saving ? "Saving…" : mode === "create" ? "Create archetype" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className="focus-ring h-9 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}
