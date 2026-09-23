"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { dropZoneProps, type DropPlan } from "./analyzeDropRouting";
import { useDropZoneHighlight } from "./useAnalyzeDropZoneHighlight";
import { AnalyzeProfileInputFileList } from "./AnalyzeProfileInputFileList";
import { DROP_ZONE_FOCUS } from "./analyzeSurfaces";
import { pastedCvFile } from "./analyzeCvIntake";
import { TextArea } from "@/app/_components/TextArea";

/**
 * The CV column. It decides nothing about where a file goes: every entry point —
 * the empty zone's picker, Add variant, the sample CV, a pasted CV — hands its files
 * to `onIntake`, the form's router, which plans them (gate per file, the variant cap,
 * a named reason for every refusal) exactly as it plans a drop. A DROP on this column
 * never reaches it at all: the empty zone is marked `cv` and the form's one window
 * listener routes it (challenge-r03 cv-analyze-intake/A).
 */
export function AnalyzeProfileInput({
  files,
  isWindowDragging,
  onIntake,
  onReplace,
  onRemove,
  onReport,
  maxVariants,
}: {
  files: File[];
  /** A file drag is active somewhere on the page (the form's window listener). */
  isWindowDragging: boolean;
  onIntake: (files: File[]) => DropPlan | null;
  onReplace: (index: number, file: File) => void;
  onRemove: (index: number) => void;
  /** Surface a refusal the plan cannot name (the sample fetch failed). */
  onReport: (message: string) => void;
  maxVariants: number;
}) {
  const t = useTranslations("analyze");
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [isPasting, setIsPasting] = useState(false);

  // Highlight only: the router owns the drop.
  const { isOver: isOverDropzone, dragProps } = useDropZoneHighlight();

  async function loadSample() {
    if (isLoadingSample) return;
    setIsLoadingSample(true);
    try {
      const response = await fetch("/samples/sample-cv.txt");
      if (!response.ok) throw new Error(`sample fetch failed (${response.status})`);
      const blob = await response.blob();
      onIntake([new File([blob], "sample-cv.txt", { type: "text/plain" })]);
    } catch {
      // A failed/blank fetch used to no-op, leaving the user staring at an
      // unchanged form after clicking "Try sample CV". Say so on the form.
      onReport(t("sampleFailed"));
    } finally {
      setIsLoadingSample(false);
    }
  }

  const pasteControl = (
    <div className="mt-3">
      <button type="button" aria-expanded={isPasting} onClick={() => setIsPasting((open) => !open)} className="focus-ring text-sm font-semibold text-coral hover:underline">
        {t("pasteCv")}
      </button>
      {isPasting ? (
        <div className="mt-2 space-y-2">
          <TextArea value={pastedText} onChange={(event) => setPastedText(event.target.value)} rows={5} aria-label={t("pasteCv")} placeholder={t("pasteCvPlaceholder")} sizeVariant="sm" />
          <button
            type="button"
            disabled={!pastedText.trim()}
            onClick={() => {
              const file = pastedCvFile(pastedText);
              if (!file) return;
              // Keep the text when the plan refused it (the cap), so nothing typed is lost.
              if (onIntake([file])?.cv.length) {
                setPastedText("");
                setIsPasting(false);
              }
            }}
            className="focus-ring rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("addPastedCv")}
          </button>
        </div>
      ) : null}
    </div>
  );

  if (files.length === 0) {
    const isActive = isWindowDragging || isOverDropzone;
    return (
      <>
        {/* A <label> announces only the input's name, so a screen-reader user was
            never told this box is a drop target or what it accepts. role="button"
            names the interaction; aria-describedby carries the localized
            format/size hint that was decorative text before. */}
        <label
          htmlFor="profile-file-0"
          role="button"
          aria-describedby="profile-file-0-hint"
          {...dropZoneProps("cv")}
          {...dragProps}
          className={`${DROP_ZONE_FOCUS} flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border px-3 text-center transition-colors ${
            isActive
              ? "border-solid border-coral bg-coral/5"
              : "border-dashed border-stone-300 bg-white hover:border-coral"
          }`}
        >
          <UploadCloud className={`h-5 w-5 ${isActive ? "text-coral" : "text-steel"}`} aria-hidden />
          <span className="mt-1 max-w-full truncate text-sm font-semibold text-ink">
            {isActive ? t("dropCvHere") : t("dropCvOrClick")}
          </span>
          <span id="profile-file-0-hint" className="text-sm text-steel">
            {t("uploadHint", { max: MAX_FILE_MB })}
          </span>
        </label>
        <input
          id="profile-file-0"
          type="file"
          multiple
          accept={ACCEPT_EXTENSIONS}
          // See AnalyzeFileDropZone: the label's role="button" costs it the
          // implicit naming of this input, so the name is given here.
          aria-label={t("dropCvOrClick")}
          aria-describedby="profile-file-0-hint"
          className="sr-only"
          onChange={(event) => {
            onIntake(Array.from(event.target.files ?? []));
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
        {pasteControl}
      </>
    );
  }

  return (
    <>
      <AnalyzeProfileInputFileList
        files={files}
        maxVariants={maxVariants}
        isWindowDragging={isWindowDragging}
        onAddFiles={onIntake}
        onReplaceFile={onReplace}
        onRemove={onRemove}
      />
      {pasteControl}
    </>
  );
}
