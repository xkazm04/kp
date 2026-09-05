// State + CRUD handlers for JdsTemplateManager.tsx — the manager file stays under
// the 200-line split threshold. Owns: the template list load (and its FAILURE),
// the editing draft and its unsaved-draft guard, save/remove/setDefault, the
// stale-save (409) recovery, and the localized validation-error mapping.
//
// The React-free half — request shapes, response classification, the list load,
// the validation-code→key map — lives in jdsTemplateClient.ts so it can be pinned
// with a fetch stub (this harness cannot render a hook).
"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  findUnknownPlaceholders,
  formatTokens,
  SUPPORTED_PLACEHOLDER_LIST,
  validateTemplateFields,
  type TemplateFieldError,
} from "@/app/features/shared/renderTemplate";
import {
  loadManagedTemplates,
  sendTemplateWrite,
  templateSaveRequest,
  type ManagedTemplate,
  type TemplateDraft,
} from "./jdsTemplateClient";

export type Editing = TemplateDraft;

/** How the manager may be left while a draft is open. Held (rather than acted on)
 *  until the recruiter answers the discard question. */
export type PendingExit = "cancel" | "close";

export function useTemplateManagerLogic({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const t = useTranslations("library.templates");
  // Same rule as localizeTemplateError below, for the SERVER's failures: resolve
  // from the machine `code`, never the English `error` kept for API consumers.
  const errMsg = useErrorMessage();
  // null = not loaded yet (render a skeleton), [] = genuinely empty (render an empty note),
  // so a slow/failed fetch is no longer indistinguishable from "loaded zero".
  const [templates, setTemplates] = useState<ManagedTemplate[] | null>(null);
  // The list load FAILED. Distinct from `templates === null`, which used to be the
  // only state a failure could reach: the promise had no rejection path at all, so
  // the skeleton pulsed forever and the rejection escaped unhandled.
  const [loadFailed, setLoadFailed] = useState(false);
  // The server said the library is longer than the page it sent (bounded read). Shown
  // as a note above the list: this panel claims to be the whole library.
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  // The draft as it was OPENED. Dirtiness is a comparison, not a flag, so an edit
  // typed and undone doesn't ask a pointless question on the way out.
  const [editingBase, setEditingBase] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A save refused because someone else saved first (409). The editor offers to
  // reload the winning row rather than leaving a dead Save button.
  const [conflict, setConflict] = useState<ManagedTemplate | null>(null);
  // Id of the template whose delete is awaiting inline confirmation (null = none).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // The exit the recruiter asked for, held while we ask whether to discard.
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await loadManagedTemplates();
      setTemplates(page.templates);
      setTruncated(page.truncated);
      setLoadFailed(false);
    } catch {
      // Say it, and offer the retry. `templates` keeps whatever it held (null on a
      // first load) so the panel renders the failure line, never a false "no
      // templates yet" about a library that may be full.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred kickoff (no synchronous setState in an effect body) — the same shape
  // jdsHooks and useJdEditor's deep-opened history use.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // one-language-jd — the validators emit stable CODES; the manager maps each to a
  // localized string (the server keeps the English `error` for API consumers). The
  // code→key map is pure (jdsTemplateClient.templateErrorKey) and pinned by a test;
  // this binds it to the catalog, where ICU values differ per key.
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

  /** Open a draft (create or edit) and remember what it looked like. */
  const beginEdit = (draft: Editing) => {
    setConfirmingId(null);
    setConflict(null);
    setError(null);
    setEditing(draft);
    setEditingBase(draft);
  };

  const closeEditor = () => {
    setEditing(null);
    setEditingBase(null);
    setConflict(null);
  };

  // A half-written rich-text body used to vanish on Cancel and on closing the
  // modal — the same silent discard wave 8 fixed for the JD builder, and the same
  // remedy: an exit with nothing to lose behaves exactly as before.
  const dirty = Boolean(
    editing && editingBase && (editing.name !== editingBase.name || editing.body !== editingBase.body || editing.scope !== editingBase.scope)
  );

  const requestExit = (exit: PendingExit) => {
    if (dirty) {
      setPendingExit(exit);
      return;
    }
    if (exit === "close") onClose();
    else closeEditor();
  };
  const keepEditing = () => setPendingExit(null);
  const discardAndExit = () => {
    const exit = pendingExit;
    setPendingExit(null);
    closeEditor();
    if (exit === "close") onClose();
  };

  /** Take the row that won the 409 and continue from it. The recruiter's own text
   *  is deliberately dropped — this is the "reload latest" recovery, the same one
   *  the JD editor offers on a conflict. */
  const reloadConflict = () => {
    if (!conflict) return;
    const fresh: Editing = { id: conflict.id, name: conflict.name, body: conflict.body, scope: conflict.scope, updatedAt: conflict.updatedAt };
    beginEdit(fresh);
    void load();
  };

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
    setConflict(null);
    try {
      const { outcome, body } = await sendTemplateWrite(
        templateSaveRequest(editing, { name: fields.name, body: fields.body })
      );
      // Template writes are operator-gated (create can publish org-shared) — surface
      // the refusal honestly rather than a generic "save failed".
      if (outcome === "gate") throw new Error(t("notPermitted"));
      if (outcome === "conflict") {
        // The winning row rides on the refusal, so the recovery is one click.
        setConflict(body?.template ?? null);
        setError(errMsg(body, t("saveFailed")));
        return;
      }
      if (outcome === "error") throw new Error(errMsg(body, t("saveFailed")));
      closeEditor();
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
      const { outcome, body } = await sendTemplateWrite({ url: `/api/templates/${encodeURIComponent(id)}`, method: "DELETE" });
      if (outcome === "gate") throw new Error(t("notPermitted"));
      // TEMPLATE_LAST_ONE / TEMPLATE_IS_DEFAULT / TEMPLATE_NOT_FOUND resolve from
      // the code, in the reader's language — the route used to answer with English
      // prose lifted straight out of the store.
      if (outcome !== "ok") throw new Error(errMsg(body, t("deleteFailed")));
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    }
  };

  const setDefault = async (id: string) => {
    setError(null);
    try {
      const { outcome, body } = await sendTemplateWrite({
        url: `/api/templates/${encodeURIComponent(id)}`,
        method: "PUT",
        payload: { isDefault: true },
      });
      if (outcome === "gate") throw new Error(t("notPermitted"));
      if (outcome !== "ok") throw new Error(errMsg(body, t("setDefaultFailed")));
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("setDefaultFailed"));
    }
  };

  return {
    t,
    templates,
    truncated,
    loading,
    loadFailed,
    reload: load,
    editing,
    setEditing,
    beginEdit,
    dirty,
    pendingExit,
    requestExit,
    keepEditing,
    discardAndExit,
    conflict,
    reloadConflict,
    busy,
    error,
    confirmingId,
    setConfirmingId,
    localizeTemplateError,
    unknownTokens,
    save,
    remove,
    setDefault,
  };
}
