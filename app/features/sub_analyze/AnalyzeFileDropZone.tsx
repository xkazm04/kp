"use client";

import { useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { ACCEPT_EXTENSIONS, MAX_FILE_HINT, validateUpload } from "@/app/_lib/upload-constraints";
import { formatFileSize } from "./AnalyzeApi";

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
  const [error, setError] = useState<string | null>(null);

  // Pre-flight the file (extension + size) before handing it up, so a bad drop
  // surfaces an inline message instead of failing only after the upload POST.
  const accept = (next: File) => {
    const err = validateUpload(next);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onFileChange(next);
  };

  if (file) {
    return (
      <>
        <div className="flex h-20 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3">
          <FileText className="h-4 w-4 shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink" title={file.name}>
              {file.name}
            </p>
            <p className="text-[10px] text-steel">{formatFileSize(file.size)}</p>
          </div>
          <label
            htmlFor={inputId}
            className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white px-2 text-[10px] font-semibold text-ink hover:bg-stone-50"
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
          accept=".pdf,.docx,.txt,.md"
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) onFileChange(next);
            event.target.value = "";
          }}
        />
      </>
    );
  }

  return (
    <>
      <label
        htmlFor={inputId}
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
          if (dropped) accept(dropped);
        }}
        className={`flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 text-center transition-colors ${
          isOver
            ? "border-solid border-coral bg-coral/5"
            : "border-stone-300 bg-white hover:border-coral"
        }`}
      >
        <UploadCloud className={`h-5 w-5 ${isOver ? "text-coral" : "text-steel"}`} aria-hidden />
        <span className="mt-1 text-xs font-semibold text-ink">
          {isOver ? "Drop here" : "Drop file or click"}
        </span>
        <span className="text-[10px] text-steel">{hint}</span>
      </label>
      {error ? <p className="mt-1 text-[10px] text-coral" role="alert">{error}</p> : null}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT_EXTENSIONS}
        className="sr-only"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) accept(next);
          event.target.value = "";
        }}
      />
    </>
  );
}
