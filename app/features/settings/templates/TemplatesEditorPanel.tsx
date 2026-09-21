"use client";

// The template form itself — name, state, scope, body, placeholder chips, live
// preview, and the three actions. Shared by variant A (right pane) and variant B
// (inside a Modal); variant C deliberately does NOT use it, because its whole
// proposition is that the body is the page rather than a field in a form.

import { useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL, toggleBtn, TOGGLE_GROUP } from "@/app/_components/ui/recipes";
import { TEMPLATE_NAME_MAX_LENGTH } from "@/app/features/shared/renderTemplate";
import { BucketSelect, PlaceholderChips, PreviewPane } from "./TemplatesShared";
import { insertTokenInto } from "./templatesCaret";
import type { MessageDraft } from "./useMessageTemplates";

export function TemplatesEditorPanel({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: MessageDraft;
  setDraft: (d: MessageDraft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Absent for a draft that has never been saved — there is nothing to delete. */
  onDelete?: () => void;
}) {
  const t = useTranslations("templates.editor");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // Deleting is destructive and irreversible, so the button asks first. Held
  // inline rather than in a second dialog: the row is already the confirmation
  // context, and a dialog over a dialog (variant B) is worse than a held button.
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="space-y-1">
          <span className={META_LABEL}>{t("name")}</span>
          <TextInput
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            placeholder={t("namePlaceholder")}
            sizeVariant="sm"
          />
        </label>
        <div className="space-y-1">
          <span className={META_LABEL}>{t("state")}</span>
          <BucketSelect
            value={draft.bucket}
            onChange={(bucket) => setDraft({ ...draft, bucket })}
            ariaLabel={t("state")}
            className="w-full sm:w-52"
          />
        </div>
      </div>

      {/* Scope is chosen ONCE, at creation: publishing to the org library is what
          the POST route's operator gate exists for, and the PUT route carries no
          scope at all — so offering the control on an edit would be a lie. */}
      {!draft.id ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={META_LABEL}>{t("scope")}</span>
          <div className={TOGGLE_GROUP} role="group" aria-label={t("scope")}>
            {(["team", "org"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft({ ...draft, scope: s })}
                aria-pressed={draft.scope === s}
                className={`focus-ring cursor-pointer rounded px-2.5 py-1 text-sm font-semibold ${toggleBtn(draft.scope === s)}`}
              >
                {s === "team" ? t("scopeTeam") : t("scopeOrg")}
              </button>
            ))}
          </div>
          <span className="text-micro text-steel">{draft.scope === "org" ? t("scopeOrgHint") : t("scopeTeamHint")}</span>
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className={META_LABEL}>{t("body")}</span>
        <TextArea
          ref={bodyRef}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          aria-label={t("body")}
          sizeVariant="sm"
          className="min-h-[16rem] font-mono"
        />
      </label>

      <PlaceholderChips onInsert={(token) => insertTokenInto(bodyRef.current, draft.body, token, (next) => setDraft({ ...draft, body: next }))} />

      <PreviewPane body={draft.body} className="max-h-[22rem]" />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={`${BTN_PRIMARY} h-9 cursor-pointer px-4 text-sm`}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {t("save")}
        </button>
        <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-9 cursor-pointer px-3 text-sm font-semibold text-steel`}>
          {t("cancel")}
        </button>
        {onDelete ? (
          <div className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm text-steel">{t("deleteConfirm")}</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                  className={`${BTN_SECONDARY} h-9 cursor-pointer px-3 text-sm font-semibold text-red-700`}
                >
                  {t("deleteYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={`${BTN_SECONDARY} h-9 cursor-pointer px-3 text-sm font-semibold text-steel`}
                >
                  {t("deleteNo")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={`${BTN_SECONDARY} h-9 cursor-pointer gap-1.5 px-3 text-sm font-semibold text-steel`}
              >
                <Trash2 size={14} aria-hidden />
                {t("delete")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
