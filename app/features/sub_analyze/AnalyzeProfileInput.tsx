"use client";

import { useState } from "react";
import { FileText, Plus, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS, MAX_FILE_HINT } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";
import { ownedDropZoneProps } from "./dropRouting";
import { useFileAccept } from "./useFileAccept";
import { useGlobalFileDrag } from "./useGlobalFileDrag";
import { useDropZoneHighlight } from "./useDropZoneHighlight";

export function AnalyzeProfileInput({
  files,
  onAdd,
  onReplace,
  onRemove,
  maxVariants,
}: {
  files: File[];
  onAdd: (file: File) => void;
  onReplace: (index: number, file: File) => void;
  onRemove: (index: number) => void;
  maxVariants: number;
}) {
  const t = useTranslations("analyze");
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  // The shared intake gate: add (incl. the sample + drop-anywhere paths) and
  // replace both route their File through `accept(file, commit)`, so a bad
  // drop/select is rejected inline rather than after the upload POST. Nothing
  // here calls onAdd/onReplace without first clearing the gate.
  const { error, accept, reject } = useFileAccept();
  // The variant cap is enforced here, at the single add choke point, so a drop
  // beyond the limit (the drop-anywhere overlay stays live even once the Add
  // button is hidden) surfaces the inline message instead of silently vanishing.
  const addFile = (file: File) => {
    if (files.length >= maxVariants) {
      reject(t("variantLimitReject", { count: maxVariants }));
      return;
    }
    accept(file, onAdd);
  };
  const replaceFile = (index: number, file: File) => accept(file, (next) => onReplace(index, next));
  // Drag-highlight state for the empty CV zone (shared with the JD/company zone).
  const { isOver: isOverDropzone, dragProps } = useDropZoneHighlight(addFile);

  const isWindowDragging = useGlobalFileDrag(addFile);

  // Drop-anywhere affordance: a full-window overlay while a file is dragged over
  // the page (pointer-events-none so the underlying drop targets still receive it).
  const dragOverlay = isWindowDragging ? (
    <div className="animate-fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-coral/5" aria-hidden>
      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-coral bg-white/90 px-10 py-8 shadow-panel">
        <UploadCloud className="h-8 w-8 text-coral" />
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-base font-semibold text-ink">{t("dropCvAnywhere")}</span>
          {/* Spell out the routing carve-out (idea-9f3a1c52): the labeled Job
              description and Company zones own their drops, so a file released on
              one of them files THERE — it is not also added as a CV variant.
              "anywhere" on its own would imply those zones too. */}
          <span className="text-sm text-steel">{t("dropCarveout")}</span>
        </div>
      </div>
    </div>
  ) : null;

  const errorRow = error ? (
    <p className="mt-1 text-sm text-coral" role="alert">{error}</p>
  ) : null;

  async function loadSample() {
    if (isLoadingSample) return;
    setIsLoadingSample(true);
    try {
      const response = await fetch("/samples/sample-cv.txt");
      if (!response.ok) throw new Error(`sample fetch failed (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], "sample-cv.txt", { type: "text/plain" });
      addFile(file);
    } catch {
      // A failed/blank fetch used to no-op, leaving the user staring at an
      // unchanged form after clicking "Try sample CV". Say so inline.
      reject(t("sampleFailed"));
    } finally {
      setIsLoadingSample(false);
    }
  }

  if (files.length === 0) {
    const isActive = isWindowDragging || isOverDropzone;
    return (
      <>
        {dragOverlay}
        {/* The empty CV zone owns its drop, so a file dropped squarely on it is
            added once by this onDrop — not also by the window catch (which would
            duplicate it). Drops elsewhere still fall through to the window catch
            as the first CV. (idea-1a75b476) */}
        <label
          htmlFor="profile-file-0"
          {...ownedDropZoneProps}
          {...dragProps}
          className={`flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border px-3 text-center transition-colors ${
            isActive
              ? "border-solid border-coral bg-coral/5"
              : "border-dashed border-stone-300 bg-white hover:border-coral"
          }`}
        >
          <UploadCloud className={`h-5 w-5 ${isActive ? "text-coral" : "text-steel"}`} aria-hidden />
          <span className="mt-1 max-w-full truncate text-sm font-semibold text-ink">
            {isActive ? t("dropCvHere") : t("dropCvOrClick")}
          </span>
          <span className="text-sm text-steel">{MAX_FILE_HINT}</span>
        </label>
        {errorRow}
        <input
          id="profile-file-0"
          type="file"
          accept={ACCEPT_EXTENSIONS}
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) addFile(next);
            event.target.value = "";
          }}
        />
        <p className="mt-2 text-center text-sm text-steel">
          {t("newHere")}{" "}
          <button
            type="button"
            onClick={loadSample}
            disabled={isLoadingSample}
            className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline disabled:opacity-60"
          >
            {isLoadingSample ? t("loadingSample") : t("trySample")}
          </button>
        </p>
      </>
    );
  }

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
              if (next) replaceFile(index, next);
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
          <input
            id={`profile-file-${files.length}`}
            type="file"
            accept={ACCEPT_EXTENSIONS}
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) addFile(next);
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

