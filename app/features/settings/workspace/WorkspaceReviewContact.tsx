"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { saveReviewContact } from "./useWorkspaceAdmin";

// The address a candidate is told to write to for a human review (owner ruling Q7).
// Shown only to those who can manage teams; empty clears it, and the candidate copy
// then names the hiring team instead of an address. The server validates the shape.
export function WorkspaceReviewContact({
  workspaceId,
  value,
  onSaved,
}: {
  workspaceId: string;
  value: string | null;
  onSaved: () => Promise<unknown> | void;
}) {
  const t = useTranslations("workspaceAdmin");
  const errMsg = useErrorMessage();
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== (value ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    const res = await saveReviewContact(workspaceId, draft.trim());
    if (res.ok) {
      toast.success(t("reviewContactSaved"));
      await onSaved();
    } else {
      toast.error(res.body ? errMsg(res.body as ApiErrorPayload, t("reviewContactFailed")) : t("reviewContactFailed"));
    }
    setSaving(false);
  }

  return (
    <form onSubmit={save} className="border-b border-stone-200 px-5 py-3">
      <label className="text-body font-medium text-ink" htmlFor={`review-contact-${workspaceId}`}>
        {t("reviewContactLabel")}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <TextInput
          id={`review-contact-${workspaceId}`}
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          sizeVariant="sm"
          className="min-w-0 max-w-sm"
        />
        <button type="submit" disabled={!dirty || saving} className={`${BTN_GHOST} h-8 px-3 text-body`}>
          {t("reviewContactSave")}
        </button>
      </div>
      <p className="mt-1 text-meta text-steel">{t("reviewContactHint")}</p>
    </form>
  );
}
