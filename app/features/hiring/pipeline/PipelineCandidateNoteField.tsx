"use client";

// Persistent per-candidate note: the call facts ("wants 80k, available August,
// hybrid") that used to die with the drawer live on the entry now, debounce-
// autosaved via usePipelineCandidateDrawerState. This is just the field + its
// quiet saving/saved hint. Split out of PipelineCandidateDrawer.tsx.

import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";

export function PipelineCandidateNoteField({
  value,
  onChange,
  status,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  status: "idle" | "saving" | "saved" | "error";
  maxLength: number;
}) {
  const t = useTranslations("pipeline.drawer");
  return (
    <div>
      <label htmlFor="candidate-note" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <NotebookPen size={13} /> {t("candidateNotes")}
        <span
          aria-live="polite"
          className={`ml-auto normal-case tracking-normal ${status === "error" ? "text-red-700" : status === "saved" ? "text-moss" : "text-steel"}`}
        >
          {status === "saving" ? t("candidateNotesSaving") : null}
          {status === "saved" ? t("candidateNotesSaved") : null}
          {status === "error" ? t("candidateNotesSaveFailed") : null}
        </span>
      </label>
      <TextArea
        id="candidate-note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={maxLength}
        placeholder={t("candidateNotesPlaceholder")}
        sizeVariant="sm"
        className="mt-1"
      />
    </div>
  );
}
