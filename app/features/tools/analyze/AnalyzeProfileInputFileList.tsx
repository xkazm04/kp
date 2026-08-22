"use client";

// The populated (files.length > 0) CV variant list — row per file with
// replace/remove, plus the "add another variant" affordance — split out of
// AnalyzeProfileInput.tsx. The empty-state drop zone stays in the parent (it
// carries the ownedDropZoneProps/dropCarveout markers some tests read as text).
import type { ReactNode } from "react";
import { FileText, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";

export function AnalyzeProfileInputFileList({
  files,
  maxVariants,
  isWindowDragging,
  dragOverlay,
  errorRow,
  onAddFiles,
  onReplaceFile,
  onRemove,
}: {
  files: File[];
  maxVariants: number;
  isWindowDragging: boolean;
  dragOverlay: ReactNode;
  errorRow: ReactNode;
  /** Batch intake — the "add another variant" picker accepts a multi-selection,
   *  so the parent's single cap/gate path decides how many of them fit. */
  onAddFiles: (files: File[]) => void;
  onReplaceFile: (index: number, file: File) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("analyze");
  const canAddMore = files.length < maxVariants;

  return (
    <div className="space-y-2">
      {dragOverlay}
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-1.5"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {files.length > 1 ? (
                <span className="text-coral">{t("variantPrefix", { letter: String.fromCharCode(65 + index) })}</span>
              ) : null}
              {file.name}
            </p>
            <p className="text-sm text-steel">{formatFileSize(file.size)}</p>
          </div>
          <label
            htmlFor={`profile-file-${index}`}
            className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white px-1.5 text-sm font-semibold text-ink hover:bg-stone-50"
            title={t("replace")}
          >
            {t("replace")}
          </label>
          <input
            id={`profile-file-${index}`}
            type="file"
            accept={ACCEPT_EXTENSIONS}
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) onReplaceFile(index, next);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={
              files.length > 1
                ? t("removeVariantAria", { letter: String.fromCharCode(65 + index) })
                : t("removeFileAria")
            }
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 bg-white text-ink hover:bg-stone-50"
            title={t("remove")}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ))}
      {canAddMore ? (
        <>
          <label
            htmlFor={`profile-file-${files.length}`}
            className={`focus-ring flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-2 py-2 text-sm font-medium text-ink transition-colors ${
              isWindowDragging
                ? "border-coral bg-coral/5"
                : "border-stone-300 bg-white hover:border-coral hover:bg-paper"
            }`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("addVariant", { current: files.length, max: maxVariants })}
          </label>
          {/* `multiple`: with room for more than one variant left, picking two
              files at once used to keep the first and drop the rest silently —
              while this very label reads "Add variant (1/3)". The parent applies
              the cap and surfaces the inline message for any overflow. */}
          <input
            id={`profile-file-${files.length}`}
            type="file"
            multiple={maxVariants - files.length > 1}
            accept={ACCEPT_EXTENSIONS}
            className="sr-only"
            onChange={(event) => {
              onAddFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </>
      ) : (
        <p className="text-sm text-steel">{t("variantLimitReached")}</p>
      )}
      {errorRow}
    </div>
  );
}
