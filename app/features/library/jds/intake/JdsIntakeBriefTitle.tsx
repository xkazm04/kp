"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { withEditProvenance } from "@/app/_lib/brief-edit";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, FIELD } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { ProvenanceDot } from "./JdsIntakeBriefAtoms";

// The brief's ROLE row — title + seniority, each with its provenance dot, and
// a three-second title correction.
//
// UAT L1-TOM-2: spineProvenance.title is tracked end-to-end by the engine and
// was rendered NOWHERE, while the title headlines the draft AND names the
// session in the sidebar. Live control arm proved an attached JD drives the
// title, and BOTH arms (attachment and none) stamped it `inferred` — so the
// chip must render whenever a title exists, not only in attachment sessions.
// This EXTENDS the spine-provenance chain the seniority chip established
// (guardrail G1); it does not alter it. A typed title is `stated` by
// definition, and withEditProvenance flips only the fields that actually
// changed, so the correction cannot launder the rest of the brief.

export function JdsIntakeBriefTitle({
  brief,
  frozen,
  saving,
  onSaveBrief,
}: {
  brief: RoleBrief | null;
  frozen?: boolean;
  saving?: boolean;
  /** Resolves false when the server refused — the field stays open with the
   *  typed title still in it (see JdsIntakeBriefPanel). */
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
}) {
  const t = useTranslations("library.tab.intake.edit");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(brief?.title ?? "");
  const canEdit = !frozen && !!onSaveBrief && !!brief;

  const save = async () => {
    if (!brief || !onSaveBrief) return;
    const ok = await onSaveBrief(withEditProvenance(brief, { ...brief, title: value.trim() }));
    if (ok !== false) setEditing(false);
  };

  if (editing && brief) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${FIELD} h-9 flex-1 min-w-[12rem]`}
          value={value}
          aria-label={t("titleField")}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={saving} onClick={() => void save()}>
          {t("save")}
        </button>
        <button type="button" className={`${BTN_GHOST} h-9 px-2 text-sm`} disabled={saving} onClick={() => setEditing(false)}>
          {t("cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-body text-ink">
      <span>{brief?.title || "—"}</span>
      {/* Spine provenance (UAT L1-TOM-2): the most prominent value on the
          surface was the only one without its reading. Missing key = default.
          A DOT, not a chip: the panel states the vocabulary once in its legend
          (JdsIntakeBriefAtoms), and the title row is the one place that still
          spelled a provenance out in words. */}
      {brief?.title ? <ProvenanceDot provenance={brief?.spineProvenance?.title ?? "default"} /> : null}
      {canEdit ? (
        <button
          type="button"
          className={`${BTN_GHOST} h-7 px-2 text-sm`}
          onClick={() => {
            setValue(brief?.title ?? "");
            setEditing(true);
          }}
        >
          {t("editTitle")}
        </button>
      ) : null}
      {brief?.seniority ? (
        <>
          <span className={CHIP_QUIET}>{brief.seniority}</span>
          {/* Spine provenance (UAT L1-CONV-3): a defaulted seniority must
              read as "assumed", never as captured. Missing key = default. */}
          <ProvenanceDot provenance={brief?.spineProvenance?.seniority ?? "default"} />
        </>
      ) : null}
    </div>
  );
}
