"use client";

// Variant C — "Compose": editor-first. The body IS the page; everything else is
// a slim bar above it and a rail beside it.
//
// The proposition being tested: writing a good rejection message is WRITING, and
// the other two variants surround the one field that matters with chrome. Here
// the template being edited is chosen from a single control in the meta bar, the
// placeholders sit in a rail within reach of the caret, and the preview replaces
// the rail rather than competing with it.
//
// There is no versions/history list, deliberately: the store keeps one `body`
// and one `updated_at` per row, so a history panel here could only be invented.

import { useRef, useState } from "react";
import { Eye, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { TEMPLATE_NAME_MAX_LENGTH } from "@/app/features/shared/renderTemplate";
import { BucketSelect, PlaceholderChips, PreviewPane, ScopeBadge } from "./TemplatesShared";
import { insertTokenInto } from "./templatesCaret";
import { draftOf, emptyDraft, type MessageDraft, type TemplatesStore } from "./useMessageTemplates";

export function TemplatesComposeVariant({ store }: { store: TemplatesStore }) {
  const t = useTranslations("templates.compose");
  const tEditor = useTranslations("templates.editor");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState<MessageDraft>(() => emptyDraft());
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const templates = store.templates ?? [];
  const current = draft.id ? templates.find((tpl) => tpl.id === draft.id) ?? null : null;

  const pick = (id: string) => {
    setConfirming(false);
    if (!id) {
      setDraft(emptyDraft());
      return;
    }
    const tpl = templates.find((x) => x.id === id);
    if (tpl) setDraft(draftOf(tpl));
  };

  const commit = async () => {
    const saved = await store.save(draft);
    // A create that landed leaves the editor on a blank sheet rather than on a
    // draft whose id it does not know — the list reload is what surfaces the row.
    if (saved && !draft.id) setDraft(emptyDraft(draft.bucket));
  };

  const destroy = async () => {
    setConfirming(false);
    if (draft.id && (await store.remove(draft.id))) setDraft(emptyDraft());
  };

  return (
    <div className="space-y-3">
      {/* ── the slim meta bar ── */}
      <div className={`${PANEL} flex flex-wrap items-center gap-2 p-3`}>
        <Select
          value={draft.id ?? ""}
          onChange={pick}
          options={templates.map((tpl) => ({ value: tpl.id, label: tpl.title }))}
          placeholder={t("pickPlaceholder")}
          ariaLabel={t("pick")}
          sizeVariant="sm"
          searchable
          className="w-full sm:w-64"
        />
        <button
          type="button"
          onClick={() => pick("")}
          className={`${BTN_SECONDARY} h-9 cursor-pointer gap-1.5 px-3 text-sm font-semibold text-steel`}
        >
          <Plus size={14} aria-hidden />
          {t("blank")}
        </button>

        <TextInput
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          maxLength={TEMPLATE_NAME_MAX_LENGTH}
          placeholder={tEditor("namePlaceholder")}
          aria-label={tEditor("name")}
          sizeVariant="sm"
          className="min-w-0 flex-1 font-semibold"
        />
        <BucketSelect
          value={draft.bucket}
          onChange={(bucket) => setDraft({ ...draft, bucket })}
          ariaLabel={tEditor("state")}
          className="w-44"
        />
        {current ? <ScopeBadge scope={current.scope} isDefault={current.isDefault} /> : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            aria-pressed={showPreview}
            className={`${BTN_SECONDARY} h-9 cursor-pointer gap-1.5 px-3 text-sm font-semibold text-steel`}
          >
            {showPreview ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            {showPreview ? t("hidePreview") : t("showPreview")}
          </button>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={store.busy}
            className={`${BTN_PRIMARY} h-9 cursor-pointer px-4 text-sm`}
          >
            {store.busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {tEditor("save")}
          </button>
        </div>
      </div>

      {/* ── the document + its rail ── */}
      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <TextArea
          ref={bodyRef}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          aria-label={tEditor("body")}
          placeholder={t("bodyPlaceholder")}
          className="min-h-[34rem] font-mono text-sm leading-6"
        />

        {showPreview ? (
          <PreviewPane body={draft.body} className="max-h-[34rem]" />
        ) : (
          <aside className={`${PANEL_SUNKEN} space-y-4 p-4`}>
            <PlaceholderChips
              onInsert={(token) =>
                insertTokenInto(bodyRef.current, draft.body, token, (next) => setDraft({ ...draft, body: next }))
              }
            />
            {draft.id ? (
              <div className="border-t border-stone-200 pt-3">
                {confirming ? (
                  <div className="space-y-2">
                    <p className="text-sm text-steel">{tEditor("deleteConfirm")}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void destroy()}
                        className={`${BTN_SECONDARY} h-9 cursor-pointer px-3 text-sm font-semibold text-red-700`}
                      >
                        {tEditor("deleteYes")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        className={`${BTN_SECONDARY} h-9 cursor-pointer px-3 text-sm font-semibold text-steel`}
                      >
                        {tEditor("deleteNo")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className={`${BTN_SECONDARY} h-9 cursor-pointer gap-1.5 px-3 text-sm font-semibold text-steel`}
                  >
                    <Trash2 size={14} aria-hidden />
                    {tEditor("delete")}
                  </button>
                )}
              </div>
            ) : null}
          </aside>
        )}
      </div>
    </div>
  );
}
