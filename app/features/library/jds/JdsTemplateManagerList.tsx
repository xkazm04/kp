"use client";

import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { useTranslations } from "next-intl";
import { DEFAULT_TEMPLATE_BODY, type Template } from "@/app/features/shared/renderTemplate";
import type { Editing } from "./jdsTemplateManagerLogic";

// The saved-templates list (with inline delete confirmation, default-star
// toggle, and the "New template" action) — extracted verbatim from
// JdsTemplateManager.tsx so that file stays under the 200-line split threshold.
export function JdsTemplateManagerList({
  templates,
  confirmingId,
  setConfirmingId,
  setEditing,
  remove,
  setDefault,
  t,
}: {
  templates: Template[] | null;
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  setEditing: (e: Editing) => void;
  remove: (id: string) => void;
  setDefault: (id: string) => void;
  t: ReturnType<typeof useTranslations<"library.templates">>;
}) {
  return (
    <div className="space-y-2">
      {templates === null ? (
        // Tier 2: the template list's height, held quietly (was three
        // pulsing bars pretending to be templates).
        <div aria-busy="true" className="reveal-quiet min-h-[8rem] rounded-lg border border-stone-200" />
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
  );
}
