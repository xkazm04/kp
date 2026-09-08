"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { BTN_GHOST, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeBriefEdit } from "./JdsIntakeBriefEdit";
import { JdsIntakeBriefBody } from "./JdsIntakeBriefBody";
import { buildBriefSections, sectionLineKeys } from "./briefSections";
import { useBriefReveal } from "./BriefRevealAtoms";

// The live brief — the surface's signature moment: the requestor WATCHES the
// structure being built while they talk. Every value carries its provenance
// (stated = their words · inferred = the agent's reading · default = template),
// its grading (weight/confidence/rationale — the defensibility layer, UAT
// drain §2.2) and, where traceable, the transcript turn it came from
// (click → the chat scrolls to and flashes that bubble). Editable in place
// (UAT drain §2.1) unless the session was promoted — then the JD exists and
// the brief is frozen.
//
// This file is the FRAME — the header, the edit/frozen states, the App-master
// slot and the empty state; JdsIntakeBriefBody.tsx draws the brief itself and
// jdsIntakeBriefModel.ts owns what counts as a duplicate.
//
// The body is "Annotated", the winner of a /prototype round run against the
// shipped flat sections and a ranked "Scorecard" — and it stayed the winner of
// a second round against "Notepad" (a continuous paper page) and "Cards" (a
// desk of section cards): both were deleted at consolidation, along with the
// switcher between them. What Annotated changed: one reading column of bulleted
// sentences with the evidence in a fixed right-hand margin, the provenance
// vocabulary stated once as a legend instead of a chip per line, and context
// facets grouped, graded and de-duplicated — the engine emits the 90-day
// sentence twice (once as a success criterion, once as a facet) and the flat
// list printed both.
//
// The one thing kept from that second round is the REVEAL: a line that lands
// while the requestor is talking types itself out, a line already on the page
// fades in once, and a line that merely survived a re-extraction does not
// animate at all (briefReveal.ts). The panel says "writing" only while a line
// is actually being written.

export function JdsIntakeBriefPanel({
  brief,
  intakeId,
  updatedAt,
  frozen,
  saving,
  onSaveBrief,
  onJumpToTurn,
  // The Triptych leaf carries its own header — suppress the inner title so
  // "Živé zadání" doesn't render twice (the edit affordance stays).
  showTitle = true,
  appMasterSlot,
}: {
  brief: RoleBrief | null;
  /** The open session and the row version its brief was read at — the edit
   *  form's draft key (intakeBriefDraft.ts). */
  intakeId: string;
  updatedAt: string | null;
  // Promoted session: the JD exists, the brief is frozen (edit hidden + note).
  frozen?: boolean;
  saving?: boolean;
  /** Resolves false when the server REFUSED the edit (409 on a promoted
   *  session, 400, offline) — edit mode then stays open holding the typed work
   *  instead of unmounting it under a one-line error. */
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
  showTitle?: boolean;
  /** App master (docs/features/app-master/README.md): the Dossier / population-fit
   *  / composed-spec card, rendered ABOVE the brief sections because everything
   *  below it was shaped by what the scan read. Absent on the other two shapes. */
  appMasterSlot?: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake.brief");
  const tEdit = useTranslations("library.tab.intake.edit");
  const [editing, setEditing] = useState(false);
  const sections = buildBriefSections(brief);
  // The reveal is owned HERE, not in the body: it has to keep classifying while
  // the edit form is open, or every line would read as brand new the moment the
  // form closes and the body remounts.
  const reveal = useBriefReveal(sectionLineKeys(sections));
  const empty =
    !brief ||
    (!brief.title && sections.length === 0);

  return (
    // `min-h-full`, not `h-full`: the leaf that holds this panel is a bounded,
    // scrolling box (JdsIntakeLayoutTriptych) — the sunken surface must cover
    // the whole leaf when the brief is short and grow past it when it is long.
    <div className={`${PANEL_SUNKEN} min-h-full space-y-5 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {showTitle ? <div className={META_LABEL}>{t("title")}</div> : null}
          {/* Only while a line is actually being written — a fact, not a header
              decoration. */}
          {reveal.writing ? (
            <span className="inline-flex items-center gap-1.5 text-meta text-coral" aria-live="polite">
              <Pencil size={12} aria-hidden />
              {t("writing")}
            </span>
          ) : null}
        </div>
        {!empty && !editing && !frozen && onSaveBrief ? (
          <button type="button" className={`${BTN_GHOST} h-8 px-2 text-sm`} onClick={() => setEditing(true)}>
            {tEdit("start")}
          </button>
        ) : null}
      </div>
      {frozen ? <p className="text-meta text-steel">{tEdit("frozen")}</p> : null}
      {appMasterSlot}
      {empty ? (
        <p className="text-body text-steel">{t("empty")}</p>
      ) : editing && brief && onSaveBrief ? (
        <JdsIntakeBriefEdit
          brief={brief}
          intakeId={intakeId}
          updatedAt={updatedAt}
          saving={saving ?? false}
          onSave={async (edited) => {
            // Close only on a CONFIRMED save. The form is the only copy of the
            // requestor's typed corrections; unmounting it on a refusal threw
            // the whole edit away and left just a red line.
            const ok = await onSaveBrief(edited);
            if (ok !== false) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <JdsIntakeBriefBody
          brief={brief}
          sections={sections}
          mode={reveal.mode}
          frozen={frozen}
          saving={saving}
          onSaveBrief={onSaveBrief}
          onJumpToTurn={onJumpToTurn}
        />
      )}
    </div>
  );
}
