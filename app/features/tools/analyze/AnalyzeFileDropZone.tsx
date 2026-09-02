"use client";

import { FileText, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";
import { ownedDropZoneProps } from "./analyzeDropRouting";
import { useFileAccept } from "./useAnalyzeFileAccept";
import { useDropZoneHighlight } from "./useAnalyzeDropZoneHighlight";
import { DROP_ZONE_FOCUS } from "./analyzeSurfaces";

export function AnalyzeFileDropZone({
  inputId,
  inputRef,
  file,
  onFileChange,
  onRemove,
  hint,
}: {
  inputId: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
  /** Overrides the default "PDF · DOCX · TXT · MD up to 8 MB" line. Omit it and
   *  the catalog supplies that line in the reader's language, with the cap
   *  interpolated from MAX_FILE_MB rather than typed into the copy. */
  hint?: string;
}) {
  const t = useTranslations("analyze");
  const hintText = hint ?? t("uploadHint", { max: MAX_FILE_MB });
  // The shared intake gate: every File below is handed to `accept(file, commit)`
  // so a bad drop/select (wrong type or >8 MB) surfaces inline instead of only
  // failing after the upload POST. No path here calls onFileChange directly.
  const { error, accept } = useFileAccept();
  const { isOver, dragProps } = useDropZoneHighlight((file) => accept(file, onFileChange));

  const errorRow = error ? (
    <p className="mt-1 text-sm text-coral" role="alert">{error}</p>
  ) : null;

  if (file) {
    return (
      <>
        {/* Owns its drop: a file dropped here is a JD/company replacement, never a
            phantom CV the window catch should also claim (idea-1a75b476). */}
        <div {...ownedDropZoneProps} className="flex h-20 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3">
          <FileText className="h-4 w-4 shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-steel">{formatFileSize(file.size)}</p>
          </div>
          <label
            htmlFor={inputId}
            className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-ink hover:bg-stone-50"
            title={t("replace")}
          >
            {t("replace")}
          </label>
          <button
            type="button"
            onClick={onRemove}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 bg-white text-ink hover:bg-stone-50"
            title={t("remove")}
            aria-label={t("removeFileAria")}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={ACCEPT_EXTENSIONS}
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) accept(next, onFileChange);
            event.target.value = "";
          }}
        />
        {errorRow}
      </>
    );
  }

  return (
    <>
      <label
        htmlFor={inputId}
        {...ownedDropZoneProps}
        {...dragProps}
        className={`${DROP_ZONE_FOCUS} flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 text-center transition-colors ${
          isOver
            ? "border-solid border-coral bg-coral/5"
            : "border-stone-300 bg-white hover:border-coral"
        }`}
      >
        <UploadCloud className={`h-5 w-5 ${isOver ? "text-coral" : "text-steel"}`} aria-hidden />
        <span className="mt-1 text-sm font-semibold text-ink">
          {isOver ? t("dropHere") : t("dropFileOrClick")}
        </span>
        <span className="text-sm text-steel">{hintText}</span>
      </label>
      {errorRow}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT_EXTENSIONS}
        className="sr-only"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) accept(next, onFileChange);
          event.target.value = "";
        }}
      />
    </>
  );
}
