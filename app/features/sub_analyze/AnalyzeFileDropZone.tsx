"use client";

import { useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { ACCEPT_EXTENSIONS, MAX_FILE_HINT } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";
import { ownedDropZoneProps } from "./dropRouting";
import { useFileAccept } from "./useFileAccept";

export function AnalyzeFileDropZone({
  inputId,
  inputRef,
  file,
  onFileChange,
  onRemove,
  hint = MAX_FILE_HINT,
}: {
  inputId: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
  hint?: string;
}) {
  const [isOver, setIsOver] = useState(false);
  // The shared intake gate: every File below is handed to `accept(file, commit)`
  // so a bad drop/select (wrong type or >8 MB) surfaces inline instead of only
  // failing after the upload POST. No path here calls onFileChange directly.
  const { error, accept } = useFileAccept();

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
            title="Replace"
          >
            Replace
          </label>
          <button
            type="button"
            onClick={onRemove}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 bg-white text-ink hover:bg-stone-50"
            title="Remove"
            aria-label="Remove file"
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
        onDragEnter={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) accept(dropped, onFileChange);
        }}
        className={`flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 text-center transition-colors ${
          isOver
            ? "border-solid border-coral bg-coral/5"
            : "border-stone-300 bg-white hover:border-coral"
        }`}
      >
        <UploadCloud className={`h-5 w-5 ${isOver ? "text-coral" : "text-steel"}`} aria-hidden />
        <span className="mt-1 text-sm font-semibold text-ink">
          {isOver ? "Drop here" : "Drop file or click"}
        </span>
        <span className="text-sm text-steel">{hint}</span>
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
