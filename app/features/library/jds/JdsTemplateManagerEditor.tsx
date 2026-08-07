"use client";

import { Loader2 } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { RichTextEditor } from "@/app/_components/RichTextEditor";
import { TextInput } from "@/app/_components/TextInput";
import {
  TEMPLATE_BODY_MAX_LENGTH,
  TEMPLATE_LOCALIZED_TOKENS,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_PLACEHOLDERS,
  type TemplateFieldError,
} from "@/app/features/shared/renderTemplate";
import type { Editing } from "./jdsTemplateManagerLogic";

// The create/edit form (name, rich-text body, placeholder legend, visibility
// toggle, save/cancel) — extracted verbatim from JdsTemplateManager.tsx so that
// file stays under the 200-line split threshold.
export function JdsTemplateManagerEditor({
  editing,
  setEditing,
  busy,
  unknownTokens,
  localizeTemplateError,
  save,
  cancel,
  t,
}: {
  editing: Editing;
  setEditing: (e: Editing) => void;
  busy: boolean;
  unknownTokens: string[];
  localizeTemplateError: (reason: TemplateFieldError) => string;
  save: () => void;
  cancel: () => void;
  t: ReturnType<typeof useTranslations<"library.templates">>;
}) {
  // The character counter sits among localized labels, so its digits group in the
  // READER's locale rather than a hardcoded en-US (format.ts number-locale contract).
  const { grouped } = useNumberFormat();
  return (
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-steel">
            {t("placeholders")}{TEMPLATE_PLACEHOLDERS.map((p) => <code key={p} className="mr-1 rounded bg-paper px-1 text-coral">{`{{${p}}}`}</code>)}
          </p>
          {/* one-language-jd — the opt-in localization tokens: heading/filler that
              render in the JD's OUTPUT language (the seeded default uses them). A
              custom template's own literal headings are the author's choice and are
              never machine-translated; these are here for authors who want to match. */}
          <p className="text-sm text-steel">
            {t("localizedTokens")}{TEMPLATE_LOCALIZED_TOKENS.map((p) => <code key={p} className="mr-1 rounded bg-paper px-1 text-moss">{`{{${p}}}`}</code>)}
          </p>
        </div>
        <p className={`shrink-0 text-sm tabular-nums ${editing.body.length >= TEMPLATE_BODY_MAX_LENGTH * 0.9 ? "text-coral" : "text-steel"}`}>
          {grouped(editing.body.length)} / {grouped(TEMPLATE_BODY_MAX_LENGTH)}
        </p>
      </div>
      {unknownTokens.length ? (
        <p className="animate-fade-in rounded-md bg-amber-50 p-2.5 text-sm text-amber-800" role="alert">
          {localizeTemplateError({ code: "unknownTokens", tokens: unknownTokens })}
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
        <button type="button" onClick={cancel} className="focus-ring h-9 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-stone-50">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
