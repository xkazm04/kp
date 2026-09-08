"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Paperclip, Pencil } from "lucide-react";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { IconAction } from "../IconAction";
import { JdsIntakeAttachmentsPane } from "../../JdsIntakeAttachmentsPane";
import { JdsIntakeBriefEdit } from "../../JdsIntakeBriefEdit";
import { JdsIntakeBriefTitle } from "../../JdsIntakeBriefTitle";
import { ProvenanceLegend } from "../../JdsIntakeBriefAtoms";
import type { BriefReveal } from "../../BriefRevealAtoms";
import type { ArrivalDelta } from "../../IntakeArrivalMotion";
import type { BriefSection } from "../../briefSections";
import type { IntakeAttachment } from "../../jdsIntakeLogic";
import { ConsoleDossierStack } from "./ConsoleDossierStack";

// THE DOSSIER — the brief as a set of stacks, one per kind of condition.
//
// The stacks are DECLARED, not derived: Role, Done in 90 days, Dealbreakers,
// Nice to have, Context are always drawn, in that order, whether or not the
// conversation has filled them. That is the whole difference from a list that
// grows from nothing — an empty stack draws one dashed outline and the reader
// can see, before answering anything, what this conversation is going to ask
// them for. The shipped panel put a sentence there instead ("The brief builds
// itself here as you talk"), which promises the same thing and shows none of it.
//
// Materials fold in here rather than under the draft: reference matter is
// EVIDENCE for the dossier, and in this coat the dossier is the record of what
// the session knows. The paperclip carries its own count, so a closed drawer
// still reports what it holds.

export function ConsoleDossier({
  brief,
  sections,
  intakeId,
  updatedAt,
  mode,
  delta,
  writing,
  frozen,
  saving,
  onSaveBrief,
  onJumpToTurn,
  appMasterSlot,
  attachments,
  savingAttachment,
  onAddAttachment,
  onRemoveAttachment,
}: {
  brief: RoleBrief | null;
  sections: BriefSection[];
  intakeId: string;
  updatedAt: string | null;
  mode: BriefReveal["mode"];
  delta: ArrivalDelta;
  /** True while a line is actually typing itself out. */
  writing: boolean;
  frozen: boolean;
  saving: boolean;
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
  appMasterSlot?: React.ReactNode;
  attachments: IntakeAttachment[];
  savingAttachment: boolean;
  onAddAttachment: (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) => void | Promise<boolean>;
  onRemoveAttachment: (index: number) => void;
}) {
  const t = useTranslations("library.tab.intake.brief");
  const tGroups = useTranslations("library.tab.intake.brief.groups");
  const tGlyph = useTranslations("library.tab.intake.glyph");
  const tEdit = useTranslations("library.tab.intake.edit");
  const [editing, setEditing] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  const of = (kind: BriefSection["kind"]) => sections.find((s) => s.kind === kind) ?? null;
  const facets = sections.filter((s) => s.kind === "facets");
  const languages = brief?.languages ?? [];

  if (editing && brief && onSaveBrief) {
    return (
      <JdsIntakeBriefEdit
        brief={brief}
        intakeId={intakeId}
        updatedAt={updatedAt}
        saving={saving}
        onSave={async (edited) => {
          // Close only on a CONFIRMED save: the form is the only copy of the
          // requestor's typed corrections.
          const ok = await onSaveBrief(edited);
          if (ok !== false) setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <ProvenanceLegend />
        <span className="flex shrink-0 items-center gap-0.5">
          {writing ? (
            <span className="mr-1 inline-flex items-center gap-1.5 text-meta text-coral" aria-live="polite">
              <Pencil size={12} aria-hidden />
              {t("writing")}
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <IconAction
              icon={Paperclip}
              label={tGlyph("materials")}
              on={materialsOpen}
              toggle
              onClick={() => setMaterialsOpen((v) => !v)}
            />
            {attachments.length > 0 ? <span className={`${CHIP_QUIET} nums`}>{attachments.length}</span> : null}
          </span>
          {frozen ? (
            // A frozen brief is a LOCK, not a paragraph: the JD exists, so the
            // record is sealed, and the reason lives in the tooltip.
            <IconAction icon={Lock} label={tEdit("frozen")} tone="muted" disabled />
          ) : onSaveBrief && brief ? (
            <IconAction icon={Pencil} label={tGlyph("edit")} onClick={() => setEditing(true)} />
          ) : null}
        </span>
      </div>

      <Collapse show={materialsOpen}>
        <div className="pb-1">
          <JdsIntakeAttachmentsPane
            quietEmpty
            attachments={attachments}
            frozen={frozen}
            saving={savingAttachment}
            onAdd={onAddAttachment}
            onRemove={onRemoveAttachment}
            showTitle={false}
          />
        </div>
      </Collapse>

      {appMasterSlot}

      <ConsoleDossierStack hue="bg-ink" label={t("role")} lines={[]} mode={mode} delta={delta}>
        {brief?.title || !frozen ? (
          <div>
            <JdsIntakeBriefTitle brief={brief} frozen={frozen} saving={saving} onSaveBrief={onSaveBrief} />
            {languages.length > 0 ? <p className="mt-1 text-meta text-steel">{languages.join(" · ")}</p> : null}
          </div>
        ) : null}
      </ConsoleDossierStack>

      <ConsoleDossierStack
        hue="bg-moss"
        label={t("outcomes")}
        lines={of("outcomes")?.lines ?? []}
        mode={mode}
        delta={delta}
        onJumpToTurn={onJumpToTurn}
      />
      <ConsoleDossierStack
        hue="bg-coral"
        label={t("dealbreakers")}
        lines={of("musts")?.lines ?? []}
        mode={mode}
        delta={delta}
        learnableOf={(line) => (line.learnable ? t("learnable") : null)}
        onJumpToTurn={onJumpToTurn}
      />
      <ConsoleDossierStack
        hue="bg-steel"
        label={t("niceToHave")}
        lines={of("nices")?.lines ?? []}
        mode={mode}
        delta={delta}
        onJumpToTurn={onJumpToTurn}
      />

      {facets.length > 0 ? (
        facets.map((section) => (
          <ConsoleDossierStack
            key={section.key}
            hue={section.hue}
            label={labelOr(tGroups, section.groupKey ?? "general", labelize(section.groupKey ?? "general"))}
            lines={section.lines}
            mode={mode}
            delta={delta}
            onJumpToTurn={onJumpToTurn}
          />
        ))
      ) : (
        // The context stack exists before anything is in it, for the same reason
        // the other four do: the shape is the promise.
        <ConsoleDossierStack hue="bg-stone-300" label={t("context")} lines={[]} mode={mode} delta={delta} />
      )}
    </div>
  );
}
