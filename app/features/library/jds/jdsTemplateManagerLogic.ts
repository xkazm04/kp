// State + CRUD handlers for JdsTemplateManager.tsx — extracted verbatim (no
// behaviour change) so the manager file stays under the 200-line split
// threshold. Owns: the template list load, the editing draft, save/remove/
// setDefault, and the localized validation-error mapping.
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  fetchTemplates,
  findUnknownPlaceholders,
  formatTokens,
  SUPPORTED_PLACEHOLDER_LIST,
  validateTemplateFields,
  type Template,
  type TemplateFieldError,
} from "@/app/features/shared/renderTemplate";

export type Editing = { id?: string; name: string; body: string; scope: Template["scope"] };

export function useTemplateManagerLogic({ onChanged }: { onChanged: () => void }) {
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

  // one-language-jd — the validators emit stable CODES; the manager maps each to a
  // localized string (the server keeps the English `error` for API consumers). One
  // switch mirrors render-template's templateErrorMessage so the two can't drift.
  const localizeTemplateError = (reason: TemplateFieldError): string => {
    switch (reason.code) {
      case "bothRequired":
        return t("errBothRequired");
      case "nameEmpty":
        return t("errNameEmpty");
      case "bodyEmpty":
        return t("errBodyEmpty");
      case "tooLong":
        return reason.field === "name" ? t("errNameTooLong", { max: reason.max }) : t("errBodyTooLong", { max: reason.max });
      case "unknownTokens":
        return t("errUnknownTokens", { count: reason.tokens.length, tokens: formatTokens(reason.tokens), supported: SUPPORTED_PLACEHOLDER_LIST });
    }
  };

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
      setError(localizeTemplateError(fields.reason));
      return;
    }
    // Belt-and-suspenders: the Save button is disabled while tokens are unknown,
    // but never let a bad body reach the API (which would 400 anyway).
    if (unknownTokens.length) {
      setError(localizeTemplateError({ code: "unknownTokens", tokens: unknownTokens }));
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

  // Both wrapped like save() above: a dropped network call or a non-JSON error
  // body would otherwise escape as an unhandled rejection — the confirm row has
  // already closed, so the user would see the click do nothing at all.
  const remove = async (id: string) => {
    setError(null);
    setConfirmingId(null);
    try {
      const r = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(p?.error ?? t("deleteFailed"));
      }
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    }
  };

  const setDefault = async (id: string) => {
    setError(null);
    try {
      const r = await fetch(`/api/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(p?.error ?? t("setDefaultFailed"));
      }
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("setDefaultFailed"));
    }
  };

  return { t, templates, editing, setEditing, busy, error, confirmingId, setConfirmingId, localizeTemplateError, unknownTokens, save, remove, setDefault };
}
