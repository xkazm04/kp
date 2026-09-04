"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { ownedDropZoneProps } from "./analyzeDropRouting";
import { useFileAccept } from "./useAnalyzeFileAccept";
import { useGlobalFileDrag } from "./useAnalyzeGlobalFileDrag";
import { useDropZoneHighlight } from "./useAnalyzeDropZoneHighlight";
import { AnalyzeProfileInputFileList } from "./AnalyzeProfileInputFileList";
import { DROP_ZONE_FOCUS } from "./analyzeSurfaces";

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
  //
  // BATCH intake: this column advertises up to `maxVariants` ("Add variant
  // (1/3)", the best-of-N comparison), so selecting three CVs at once and
  // dropping them is the natural gesture — but every entry point used to read
  // `files[0]` and discard the rest with NO message anywhere, leaving the user
  // reading "1 of 3" and assuming the other two were queued. Each file still
  // clears the same `accept` gate one at a time (nothing bypasses it); the loop
  // stops on the first rejection so the gate's inline message can't be cleared
  // by a later file's success, and a batch that overflows the cap ends on the
  // same message a single over-cap drop already produced.
  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const room = maxVariants - files.length;
    if (room <= 0) {
      reject(t("variantLimitReject", { count: maxVariants }));
      return;
    }
    for (const file of incoming.slice(0, room)) {
      let committed = false;
      accept(file, (next) => {
        committed = true;
        onAdd(next);
      });
      if (!committed) return; // the gate already said why; don't overwrite it
    }
    if (incoming.length > room) reject(t("variantLimitReject", { count: maxVariants }));
  };
  const addFile = (file: File) => addFiles([file]);
  const replaceFile = (index: number, file: File) => accept(file, (next) => onReplace(index, next));
  // Drag-highlight state for the empty CV zone (shared with the JD/company zone).
  // The shared hook's own `onDrop` commits `dataTransfer.files[0]` only; the
  // empty zone overrides it below to take the whole batch, so `addFile` here is
  // the single-file fallback the hook's signature still expects.
  const { isOver: isOverDropzone, dragProps } = useDropZoneHighlight(addFile);

  const isWindowDragging = useGlobalFileDrag(addFile);

  // Drop-anywhere affordance: a full-window overlay while a file is dragged over
  // the page (pointer-events-none so the underlying drop targets still receive it).
  // The overlay itself stays aria-hidden — it is a decorative full-window scrim
  // and its text is duplicated below — but the FACT that the page has become a
  // drop target is announced once, politely, through a live region that is always
  // in the tree (a region mounted at the same moment as its content is not
  // reliably announced). Empty when no drag is active, so it says nothing then.
  const dragAnnouncement = (
    <p role="status" aria-live="polite" className="sr-only">
      {isWindowDragging ? `${t("dropCvAnywhere")} ${t("dropCarveout")}` : ""}
    </p>
  );

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
        {dragAnnouncement}
        {/* A <label> announces only the input's name, so a screen-reader user was
            never told this box is a drop target or what it accepts. role="button"
            names the interaction; aria-describedby carries the localized
            format/size hint that was decorative text before. */}
        <label
          htmlFor="profile-file-0"
          role="button"
          aria-describedby="profile-file-0-hint"
          {...ownedDropZoneProps}
          {...dragProps}
          // Deliberately AFTER {...dragProps}: the shared highlight hook's onDrop
          // commits only files[0]. Snapshot the whole FileList (valid only during
          // dispatch), clear the highlight through the hook's own leave handler,
          // then run the batch through the single cap/gate path above.
          onDrop={(event) => {
            const dropped = Array.from(event.dataTransfer?.files ?? []);
            event.preventDefault();
            dragProps.onDragLeave(event);
            addFiles(dropped);
          }}
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
        {errorRow}
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
            addFiles(Array.from(event.target.files ?? []));
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

  return (
    <AnalyzeProfileInputFileList
      files={files}
      dragAnnouncement={dragAnnouncement}
      maxVariants={maxVariants}
      isWindowDragging={isWindowDragging}
      dragOverlay={dragOverlay}
      errorRow={errorRow}
      onAddFiles={addFiles}
      onReplaceFile={replaceFile}
      onRemove={onRemove}
    />
  );
}

