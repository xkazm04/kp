"use client";

// Interviewer assignment (PREP5) + interviewer notes (PREP2) fields for the
// prep modal — autosaved with the checklist. Split out of
// ScheduleInterviewPrepModal.tsx to keep the modal file under the 200-line cap.

import { NotebookPen, UserRound } from "lucide-react";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import type { useTranslations } from "next-intl";

export function InterviewerAndNotes({
  interviewer,
  setInterviewer,
  notes,
  setNotes,
  markEdited,
  t,
}: {
  interviewer: string;
  setInterviewer: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  markEdited: () => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  return (
    <>
      {/* Interviewer assignment (PREP5): who owns this round. Autosaved with the
          checklist; surfaced on the schedule card so a multi-interviewer team
          sees ownership at a glance. */}
      <section>
        <label htmlFor="prep-interviewer" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <UserRound size={13} /> {t("interviewer")}
        </label>
        <TextInput
          id="prep-interviewer"
          type="text"
          value={interviewer}
          onChange={(e) => {
            markEdited();
            setInterviewer(e.target.value);
          }}
          placeholder={t("interviewerPlaceholder")}
          sizeVariant="sm"
          className="mt-1.5"
        />
      </section>

      {/* Interviewer notes (PREP2): a durable scratchpad for verbatim quotes /
          evidence, autosaved with the checklist and restored on reopen. */}
      <section>
        <label htmlFor="prep-notes" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <NotebookPen size={13} /> {t("interviewerNotes")}
        </label>
        <TextArea
          id="prep-notes"
          value={notes}
          onChange={(e) => {
            markEdited();
            setNotes(e.target.value);
          }}
          rows={3}
          placeholder={t("notesPlaceholder")}
          sizeVariant="sm"
          className="mt-1.5"
        />
      </section>
    </>
  );
}
