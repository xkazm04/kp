"use client";

import { useState } from "react";
import { ClipboardList, Scale } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import type { IntakeLogic, IntakeSession } from "./jdsIntakeLogic";

// The studio header's right-hand actions: export the record, re-open a finished
// conversation, and create the JD. Split out of the overlay so that file stays
// the dialog's frame (identity, disclosure, the close contract) rather than also
// being a toolbar.
//
// Nothing here is new behaviour — these are the affordances the session view has
// carried since the defensibility and promote-flag passes, moved to where the
// session now lives.

/** The director/inspector artifact (UAT drain §2.2): brief + numbered transcript
 *  + provenance as one markdown download, built client-side from the session. */
export function IntakeExportButton({ active }: { active: IntakeSession }) {
  const t = useTranslations("library.tab.intake");
  const tBrief = useTranslations("library.tab.intake.brief");
  const tProv = useTranslations("library.tab.intake.provenance");
  const tDef = useTranslations("library.tab.intake.defense");
  const tRoles = useTranslations("library.tab.intake.roles");
  if (!active.brief) return null;
  const download = async () => {
    const { buildIntakeExportMarkdown } = await import("@/app/_lib/intake-export");
    const md = buildIntakeExportMarkdown(
      { title: active.title || active.brief?.title || "", brief: active.brief, transcript: active.transcript },
      {
        title: t("export.fileTitle"),
        role: tBrief("role"),
        seniority: tBrief("role"),
        outcomes: tBrief("outcomes"),
        dealbreakers: tBrief("dealbreakers"),
        niceToHave: tBrief("niceToHave"),
        languages: tBrief("languages"),
        context: tBrief("context"),
        transcript: t("turns", { count: active.transcript.length }),
        provenance: { stated: tProv("stated"), inferred: tProv("inferred"), default: tProv("default") },
        weight: tDef("weight"),
        confidence: tDef("confidence"),
        fromTurn: tDef("fromTurn"),
        agent: tRoles("agent"),
        requestor: tRoles("requestor"),
        system: tRoles("system"),
      }
    );
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(active.title || "intake").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} onClick={download}>
      {t("export.button")}
    </button>
  );
}

export function IntakeStudioActions({ active, logic }: { active: IntakeSession; logic: IntakeLogic }) {
  const t = useTranslations("library.tab.intake");
  // Same checklist semantics as the JD builder: the work-sample case is an
  // explicit opt-in; the (Czech-market) salary read is an opt-OUT, so the default
  // preserves the shipped behaviour (UAT L1-HRBP-11).
  const [withCase, setWithCase] = useState(false);
  const [withMarket, setWithMarket] = useState(true);
  // UAT L2-RC-1 — the gate must say what it is waiting for, from the same
  // computation `ready` is derived from.
  const blockers = briefPromoteBlockers(active.brief);
  const ready = blockers.length === 0;
  const promoteHint = ready ? undefined : blockers.map((b) => t(`promoteMissing.${b}`)).join(" ");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <IntakeExportButton active={active} />
      {active.status === "complete" ? (
        // Re-open (UAT drain §2.1): a finished conversation can take another
        // thought; the server appends a system turn so the record stays honest.
        <button
          type="button"
          className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
          disabled={logic.reopening}
          onClick={() => logic.reopen(t("reopen.note"))}
        >
          {t("reopen.button")}
        </button>
      ) : null}
      {active.status === "promoted" && active.jdSlug ? (
        <span className="text-body text-moss">{t("promoted")}</span>
      ) : (
        <>
          {/* Two options, as pressed glyphs whose meaning lives in a tooltip: an
              option is a picture with a name, not a checkbox beside a sentence
              (studioContract.ts). What a click buys is unchanged — the case is
              opt-IN, the salary read opt-OUT (DEFAULT_PROMOTE_OPTIONS). */}
          <span className="flex items-center gap-0.5">
            <IconAction
              icon={ClipboardList}
              label={t("promoteCaseShort")}
              hint={t("promoteCaseHint")}
              on={withCase}
              toggle
              side="bottom"
              disabled={logic.promoting}
              onClick={() => setWithCase((v) => !v)}
            />
            <IconAction
              icon={Scale}
              label={t("promoteMarketShort")}
              hint={t("promoteMarketHint")}
              on={withMarket}
              toggle
              side="bottom"
              disabled={logic.promoting}
              onClick={() => setWithMarket((v) => !v)}
            />
          </span>
          <button
            type="button"
            className={`${BTN_SECONDARY} h-9 px-4 text-sm`}
            disabled={!ready || logic.promoting}
            onClick={() => logic.promote({ caseDesign: withCase, marketResearch: withMarket })}
            title={promoteHint}
          >
            {logic.promoting ? t("promoting") : t("promote")}
          </button>
        </>
      )}
    </div>
  );
}
