"use client";

import { useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";
import { dropZoneProps, planSingleSlot } from "./analyzeDropRouting";
import { useRefusalText } from "./useAnalyzeFileAccept";
import { useDropZoneHighlight } from "./useAnalyzeDropZoneHighlight";
import { DROP_ZONE_FOCUS } from "./analyzeSurfaces";

/**
 * A single-file upload zone. Two ways to host it:
 *
 *  - Inside the Analyze form: pass `zone` and `onIntake`. The zone marks itself with
 *    its id and commits nothing on a drop — the form's one window listener resolves
 *    the id and plans the drop (challenge-r03 cv-analyze-intake/A); the picker hands
 *    its selection to the same `onIntake`, and refusals render on the form.
 *  - Standalone (the /me profile import, where no router listens): pass
 *    `onFileChange`. The zone plans its own single slot with the same pure
 *    `planSingleSlot` and shows any refusal inline.
 */
export function AnalyzeFileDropZone({
  inputId,
  inputRef,
  file,
  zone,
  onIntake,
  onFileChange,
  onRemove,
  hint,
}: {
  inputId: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  /** The router id this zone declares inside the Analyze form. */
  zone?: "jd" | "company";
  /** Hosted intake: the form plans and commits these files. */
  onIntake?: (files: File[]) => void;
  /** Standalone intake: called with the file this zone's own plan accepted. */
  onFileChange?: (file: File) => void;
  onRemove: () => void;
  /** Overrides the default "PDF · DOCX · TXT · MD up to 8 MB" line. Omit it and
   *  the catalog supplies that line in the reader's language, with the cap
   *  interpolated from MAX_FILE_MB rather than typed into the copy. */
  hint?: string;
}) {
  const t = useTranslations("analyze");
  const describe = useRefusalText();
  const [error, setError] = useState<string | null>(null);
  const hintText = hint ?? t("uploadHint", { max: MAX_FILE_MB });

  function takeFiles(files: File[]) {
    if (onIntake) {
      onIntake(files);
      return;
    }
    if (files.length === 0) return;
    const { slot, refused } = planSingleSlot(files, file !== null);
    if (slot) onFileChange?.(slot.file);
    setError(refused.length > 0 ? refused.map(describe).join(" ") : null);
  }

  // Hosted zones only highlight; the window router owns their drop. A standalone
  // zone takes its own drop, since nothing else is listening.
  const { isOver, dragProps } = useDropZoneHighlight(onIntake ? undefined : takeFiles);
  const marker = zone ? dropZoneProps(zone) : {};
  // The zone is a <label>, which assistive tech announces as the input's name and
  // nothing more: a screen-reader user heard the field label and never learned
  // that the box is also a drop target, nor what it accepts. role="button" makes
  // the interaction it really offers announceable, and aria-describedby points at
  // the localized format/size hint that was previously decorative text only.
  const hintId = `${inputId}-hint`;

  const errorRow = error ? (
    <p className="mt-1 text-sm text-coral" role="alert">{error}</p>
  ) : null;

  const picker = (
    <input
      id={inputId}
      ref={inputRef}
      type="file"
      accept={ACCEPT_EXTENSIONS}
      // The empty state's wrapping <label> carries role="button" so the drop
      // affordance is announceable, and an element with an explicit role no longer
      // labels its input. Name the input outright rather than rely on that.
      aria-label={file ? t("replace") : t("dropFileOrClick")}
      aria-describedby={file ? undefined : hintId}
      className="sr-only"
      onChange={(event) => {
        takeFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
    />
  );

  if (file) {
    return (
      <>
        {/* The attached card is a drop target too: a file dropped on it REPLACES the
            attachment (it used to be marked owned with no handler, so the drop was
            swallowed). */}
        <div
          {...marker}
          {...dragProps}
          className={`flex h-20 items-center gap-2 rounded-lg border bg-white px-3 transition-colors ${
            isOver ? "border-coral" : "border-stone-200"
          }`}
        >
          <FileText className="h-4 w-4 shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-steel">{isOver ? t("dropHere") : formatFileSize(file.size)}</p>
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
        {picker}
        {errorRow}
      </>
    );
  }

  return (
    <>
      <label
        htmlFor={inputId}
        role="button"
        aria-describedby={hintId}
        {...marker}
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
        <span id={hintId} className="text-sm text-steel">{hintText}</span>
      </label>
      {errorRow}
      {picker}
    </>
  );
}
