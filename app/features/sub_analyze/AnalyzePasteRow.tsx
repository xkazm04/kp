"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";

export function AnalyzePasteRow({
  ariaLabel,
  inputId,
  text,
  onChange,
  onClear,
}: {
  ariaLabel: string;
  inputId: string;
  text: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("analyze");
  const [isEditing, setIsEditing] = useState(false);
  const hasContent = text.trim().length > 0;
  // Visible textarea when empty or while editing; otherwise a compact preview.
  const showTextarea = !hasContent || isEditing;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-semibold uppercase tracking-wide text-steel"
      >
        {t("pasteContent")}
      </label>
      <textarea
        id={inputId}
        aria-label={ariaLabel}
        rows={showTextarea ? 4 : 1}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setIsEditing(false)}
        // Kept in the DOM even when collapsed (sr-only) so the aria-label target
        // stays addressable for tests + screen readers; visually it's replaced
        // by the editable preview card below.
        className={
          showTextarea
            ? "focus-ring h-24 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-ink"
            : "sr-only"
        }
      />
      {hasContent && !isEditing ? (
        <div className="rounded-md border border-stone-200 bg-paper px-2 py-1.5">
          <p className="line-clamp-2 whitespace-pre-wrap text-sm text-ink">{text.trim()}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-sm text-steel">{t("charsCount", { count: text.trim().length })}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="focus-ring inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-sm font-semibold text-ink hover:bg-stone-100"
              >
                <Pencil className="h-3 w-3" aria-hidden /> {t("edit")}
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label={t("clearPastedAria")}
                title={t("clear")}
                className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md text-coral hover:bg-coral/10"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
