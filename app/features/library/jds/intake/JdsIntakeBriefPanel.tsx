"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeBriefEdit } from "./JdsIntakeBriefEdit";
import { JdsIntakeBriefBody } from "./JdsIntakeBriefBody";

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
// shipped flat sections and a ranked "Scorecard" (both deleted at consolidation,
// along with the switcher between them). What it changed: one reading column of
// bulleted sentences with the evidence in a fixed right-hand margin, the
// provenance vocabulary stated once as a legend instead of a chip per line, and
// context facets grouped, graded and de-duplicated — the engine emits the 90-day
// sentence twice (once as a success criterion, once as a facet) and the flat
// list printed both.

export function JdsIntakeBriefPanel({
  brief,
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
  const musts = (brief?.requirements ?? []).filter((r) => r.kind === "must_have");
  const nices = (brief?.requirements ?? []).filter((r) => r.kind === "nice_to_have");
  const empty =
    !brief ||
    (!brief.title && musts.length === 0 && nices.length === 0 && (brief.successCriteria ?? []).length === 0 && (brief.facets ?? []).length === 0);
  const bodyProps = { brief, musts, nices, frozen, saving, onSaveBrief, onJumpToTurn };

  return (
    <div className={`${PANEL_SUNKEN} h-full space-y-5 p-4`}>
      <div className="flex items-center justify-between gap-2">
        {showTitle ? <div className={META_LABEL}>{t("title")}</div> : <span />}
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
        <JdsIntakeBriefBody {...bodyProps} />
      )}
    </div>
  );
}
