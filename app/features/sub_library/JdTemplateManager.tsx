"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { DEFAULT_TEMPLATE_BODY, fetchTemplates, findUnknownPlaceholders, TEMPLATE_BODY_MAX_LENGTH, TEMPLATE_NAME_MAX_LENGTH, TEMPLATE_PLACEHOLDERS, unknownPlaceholderMessage, validateTemplateFields, type Template, type TemplateData } from "./render-template";

type Editing = { id?: string; name: string; body: string };

// Phase 1 follow-up — full CRUD of company JD templates. A template is markdown
// with {{placeholders}} (see render-template.ts).
export function JdTemplateManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  // null = not loaded yet (render a skeleton), [] = genuinely empty (render an empty note),
  // so a slow/failed fetch is no longer indistinguishable from "loaded zero".
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Id of the template whose delete is awaiting inline confirmation (null = none).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = () => fetchTemplates().then(setTemplates);
  useEffect(() => {
    load();
  }, []);

  // Unknown {{tokens}} in the body being edited — the same check the API enforces
  // (render-template.ts), surfaced live so the author fixes a typo before saving
  // rather than discovering it as raw text on a published JD.
  const unknownTokens = editing ? findUnknownPlaceholders(editing.body) : [];

  const save = async () => {
    if (!editing) return;
    // Same caps + wording as the write boundary (validateTemplateFields), so the
    // form fails fast with the identical message — including rejecting a
    // whitespace-only name — instead of a round-trip 400.
    const fields = validateTemplateFields(editing.name, editing.body);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    // Belt-and-suspenders: the Save button is disabled while tokens are unknown,
    // but never let a bad body reach the API (which would 400 anyway).
    if (unknownTokens.length) {
      setError(unknownPlaceholderMessage(unknownTokens));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = editing.id ? `/api/templates/${editing.id}` : "/api/templates";
      const r = await fetch(url, {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fields.name, body: fields.body }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "Save failed.");
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setConfirmingId(null);
    const r = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const p = await r.json();
      setError(p.error ?? "Delete failed.");
      return;
    }
    await load();
    onChanged();
  };

  const setDefault = async (id: string) => {
    setError(null);
    const r = await fetch(`/api/templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    if (!r.ok) {
      const p = await r.json();
      setError(p.error ?? "Couldn't set the default.");
      return;
    }
    await load();
    onChanged();
  };

  return (
    <Modal title="Company JD templates" subtitle="Manage the formats your job descriptions are built from" size="3xl" onClose={onClose}>
      {error ? <p className="mb-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
      {editing ? (
        <div className="space-y-3">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            placeholder="Template name"
            aria-label="Template name"
            className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm font-semibold"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            maxLength={TEMPLATE_BODY_MAX_LENGTH}
            rows={16}
            aria-label="Template body"
            className="focus-ring w-full rounded-md border border-stone-200 p-3 font-mono text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-steel">
              Placeholders: {TEMPLATE_PLACEHOLDERS.map((p) => <code key={p} className="mr-1 rounded bg-paper px-1 text-coral">{`{{${p}}}`}</code>)}
            </p>
            <p className={`shrink-0 text-sm tabular-nums ${editing.body.length >= TEMPLATE_BODY_MAX_LENGTH * 0.9 ? "text-coral" : "text-steel"}`}>
              {editing.body.length.toLocaleString("en-US")} / {TEMPLATE_BODY_MAX_LENGTH.toLocaleString("en-US")}
            </p>
          </div>
          {unknownTokens.length ? (
            <p className="animate-fade-in rounded-md bg-amber-50 p-2.5 text-sm text-amber-800" role="alert">
              {unknownPlaceholderMessage(unknownTokens)}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || unknownTokens.length > 0} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Save template
            </button>
            <button type="button" onClick={() => setEditing(null)} className="focus-ring h-9 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-stone-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {templates === null ? (
            <ul aria-busy="true" className="divide-y divide-stone-100 rounded-lg border border-stone-200">
              {[0, 1, 2].map((s) => (
                <li key={s} className="px-3 py-2.5">
                  <span className="block h-4 w-2/3 animate-pulse rounded bg-stone-100" />
                </li>
              ))}
            </ul>
          ) : templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 bg-paper p-3 text-sm text-steel">
              No templates saved yet — create one below.
            </p>
          ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{t.name}</span>
                {t.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-1.5 py-0.5 text-micro font-semibold uppercase text-moss">
                    <Star size={11} className="fill-current" /> Default
                  </span>
                ) : (
                  <button type="button" onClick={() => setDefault(t.id)} className="focus-ring rounded-md p-1.5 text-steel hover:bg-moss/10 hover:text-moss" title="Set as default">
                    <Star size={15} />
                  </button>
                )}
                <button type="button" onClick={() => { setConfirmingId(null); setEditing({ id: t.id, name: t.name, body: t.body }); }} className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100" title="Edit">
                  <Pencil size={15} />
                </button>
                {confirmingId === t.id ? (
                  <span className="animate-fade-in inline-flex items-center gap-1" role="group" aria-label={`Delete the ${t.name} template?`}>
                    <span className="text-micro font-semibold text-red-700">Delete?</span>
                    <button
                      type="button"
                      onClick={() => remove(t.id)}
                      className="focus-ring rounded-md border border-red-300 bg-red-50 px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setConfirmingId(null)}
                      className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(t.id)}
                    disabled={t.isDefault}
                    className="focus-ring rounded-md p-1.5 text-steel hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-steel"
                    title={t.isDefault ? "Set another template as default before deleting this one" : "Delete"}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          )}
          <button type="button" onClick={() => { setConfirmingId(null); setEditing({ name: "", body: DEFAULT_TEMPLATE_BODY }); }} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-stone-50">
            <Plus size={15} /> New template
          </button>
        </div>
      )}
    </Modal>
  );
}

// Re-export for the composer's convenience.
export type { TemplateData };
