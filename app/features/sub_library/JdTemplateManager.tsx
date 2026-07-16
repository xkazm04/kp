"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { RichTextEditor } from "@/app/_components/RichTextEditor";
import { TextInput } from "@/app/_components/TextInput";
import { DEFAULT_TEMPLATE_BODY, fetchTemplates, findUnknownPlaceholders, TEMPLATE_BODY_MAX_LENGTH, TEMPLATE_NAME_MAX_LENGTH, TEMPLATE_PLACEHOLDERS, unknownPlaceholderMessage, validateTemplateFields, type Template, type TemplateData } from "./render-template";

type Editing = { id?: string; name: string; body: string; scope: Template["scope"] };

// Phase 1 follow-up — full CRUD of company JD templates. A template is markdown
// with {{placeholders}} (see render-template.ts).
export function JdTemplateManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("library.templates");
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
        // scope is chosen only at CREATE (publish to the shared org library vs keep it
        // team-private); an edit leaves the tier untouched, so it's omitted on PUT.
        body: JSON.stringify(
          editing.id ? { name: fields.name, body: fields.body } : { name: fields.name, body: fields.body, scope: editing.scope }
        ),
      });
      // Template writes are operator-gated (create can publish org-shared) — surface
      // the refusal honestly rather than a generic "save failed".
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? t("saveFailed"));
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setConfirmingId(null);
    const r = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (r.status === 401 || r.status === 403) {
      setError(t("notPermitted"));
      return;
    }
    if (!r.ok) {
      const p = await r.json();
      setError(p.error ?? t("deleteFailed"));
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
    if (r.status === 401 || r.status === 403) {
      setError(t("notPermitted"));
      return;
    }
    if (!r.ok) {
      const p = await r.json();
      setError(p.error ?? t("setDefaultFailed"));
      return;
    }
    await load();
    onChanged();
  };

  return (
    <Modal title={t("title")} subtitle={t("subtitle")} size="3xl" onClose={onClose}>
      {error ? <p className="mb-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
      {editing ? (
        <div className="space-y-3">
          <TextInput
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            placeholder={t("namePlaceholder")}
            aria-label={t("namePlaceholder")}
            sizeVariant="sm"
            className="font-semibold"
          />
          <RichTextEditor
            value={editing.body}
            onChange={(body) => setEditing({ ...editing, body })}
            ariaLabel={t("bodyAria")}
            minHeight="18rem"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-steel">
              {t("placeholders")}{TEMPLATE_PLACEHOLDERS.map((p) => <code key={p} className="mr-1 rounded bg-paper px-1 text-coral">{`{{${p}}}`}</code>)}
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
          {!editing.id ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-steel">{t("visibility")}</span>
              <div className="inline-flex rounded-md border border-stone-200 p-0.5">
                {(["team", "org"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditing({ ...editing, scope: s })}
                    aria-pressed={editing.scope === s}
                    className={`focus-ring rounded px-2.5 py-1 text-sm font-semibold ${editing.scope === s ? "bg-ink text-white" : "text-steel hover:bg-stone-50"}`}
                  >
                    {s === "team" ? t("scopeTeamOption") : t("scopeOrgOption")}
                  </button>
                ))}
              </div>
              <span className="text-micro text-steel">{editing.scope === "org" ? t("scopeOrgHint") : t("scopeTeamHint")}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || unknownTokens.length > 0} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} {t("saveTemplate")}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="focus-ring h-9 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-stone-50">
              {t("cancel")}
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
              {t("empty")}
            </p>
          ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{tpl.name}</span>
                <span
                  className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel"
                  title={tpl.scope === "org" ? t("scopeSharedTitle") : t("scopePrivateTitle")}
                >
                  {tpl.scope === "org" ? t("scopeShared") : t("scopePrivate")}
                </span>
                {/* The default is an org-wide baseline — only a shared (org) template can hold it. */}
                {tpl.scope === "org" ? (
                  tpl.isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-1.5 py-0.5 text-micro font-semibold uppercase text-moss">
                      <Star size={11} className="fill-current" /> {t("default")}
                    </span>
                  ) : (
                    <button type="button" onClick={() => setDefault(tpl.id)} className="focus-ring rounded-md p-1.5 text-steel hover:bg-moss/10 hover:text-moss" title={t("setDefaultTitle")}>
                      <Star size={15} />
                    </button>
                  )
                ) : null}
                <button type="button" onClick={() => { setConfirmingId(null); setEditing({ id: tpl.id, name: tpl.name, body: tpl.body, scope: tpl.scope }); }} className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100" title={t("editTitle")}>
                  <Pencil size={15} />
                </button>
                {confirmingId === tpl.id ? (
                  <span className="animate-fade-in inline-flex items-center gap-1" role="group" aria-label={t("deleteGroupAria", { name: tpl.name })}>
                    <span className="text-micro font-semibold text-red-700">{t("deletePrompt")}</span>
                    <button
                      type="button"
                      onClick={() => remove(tpl.id)}
                      className="focus-ring rounded-md border border-red-300 bg-red-50 px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100"
                    >
                      {t("confirm")}
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setConfirmingId(null)}
                      className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100"
                    >
                      {t("cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(tpl.id)}
                    disabled={tpl.isDefault}
                    className="focus-ring rounded-md p-1.5 text-steel hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-steel"
                    title={tpl.isDefault ? t("deleteTitleDisabled") : t("deleteTitleEnabled")}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          )}
          <button type="button" onClick={() => { setConfirmingId(null); setEditing({ name: "", body: DEFAULT_TEMPLATE_BODY, scope: "team" }); }} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-stone-50">
            <Plus size={15} /> {t("newTemplate")}
          </button>
        </div>
      )}
    </Modal>
  );
}

// Re-export for the composer's convenience.
export type { TemplateData };
