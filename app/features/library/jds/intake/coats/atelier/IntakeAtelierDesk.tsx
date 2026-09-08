"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { briefDraftHasContent } from "@/app/_lib/intake-draft";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import { briefItemCount } from "../../jdsIntakeBriefModel";
import { JdsIntakeAppMasterCard } from "../../JdsIntakeAppMasterCard";
import { JdsIntakeAttachmentsPane } from "../../JdsIntakeAttachmentsPane";
import { JdsIntakeVoice } from "../../JdsIntakeVoice";
import { readStoredColumns, storeColumns, toggleColumn, type IntakeColumnKey } from "../../intakeLayoutShared";
import type { useAppMasterLogic } from "../../jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession } from "../../jdsIntakeLogic";
import { AtelierZone } from "./atelierPlane";
import { AtelierBriefPlane } from "./AtelierBriefPlane";
import { AtelierComposer } from "./AtelierComposer";
import { AtelierDraftSheet } from "./AtelierDraftSheet";
import { AtelierTranscript } from "./AtelierTranscript";

// THE ATELIER COAT — a designer's desk, not three chat boxes.
//
// The classic desk's dated tell is NESTING: three rounded, bordered cards
// floating inside another rounded bordered card, with chat bubbles inside those,
// a sunken panel inside one of them and a bordered disclosure inside another.
// Five radii deep before the eye reaches a sentence the requestor came to read.
//
// Atelier keeps the same three zones, the same information and every behaviour,
// and replaces the boxes with PLANES: one continuous white surface, zones
// separated by a hairline, hierarchy carried by type and space. The zone head is
// quiet and sticky, its count is a bare tabular numeral rather than a pill, and
// the fold control only exists while the pointer or the keyboard is inside the
// zone.
//
// NO SENTENCE OCCUPIES LAYOUT (coatKit.ts). What the classic desk said in prose,
// this coat says with a glyph and a tooltip: the materials cue, the composer
// placeholder, the empty-brief and empty-draft promises, the "dictation is not
// set up" notices, the "the last open column stays open" title, the slow-thinking
// beat. An empty region shows the SHAPE of what will fill it; an absent
// capability is drawn struck, with the reason one hover away. Errors and the
// degraded-engine disclosure stay exactly where they were — the overlay owns
// them, and they are not chrome.

const STORAGE_KEY = "kp-intake-atelier-cols";
const ZONES: IntakeColumnKey[] = ["draft", "chat", "brief"];
const DEFAULT_OPEN: IntakeColumnKey[] = ["draft", "chat", "brief"];

export function IntakeAtelierDesk({
  active,
  logic,
  appMaster,
}: {
  active: IntakeSession;
  logic: IntakeLogic;
  appMaster: ReturnType<typeof useAppMasterLogic>;
}) {
  const t = useTranslations("library.tab.intake");
  const tCols = useTranslations("library.tab.intake.columns");
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(STORAGE_KEY, DEFAULT_OPEN));
  // Deliberately not persisted: the fold state is a preference, "show me the
  // materials now" is an intent.
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const closed = active.status !== "open";
  const frozen = active.status === "promoted";
  // The same computation the promote gate reads, so the draft numeral and the
  // disabled Create JD button can never disagree (UAT L2-RC-1).
  const promotable = briefPromoteBlockers(active.brief).length === 0;
  const started = briefDraftHasContent(active.brief);
  const attachments = active.attachments ?? [];
  const scanNote = appMaster.scanState ? t(`appMaster.scan.${appMaster.scanState}`) : null;
  const fenceNote = appMaster.scanFence ? t(`appMaster.scan.${appMaster.scanFence}`) : null;
  const objectiveCount = (active.brief?.facets ?? []).filter((f) => f.key?.startsWith("objective:")).length;
  const hasJdAttachment = attachments.some((a) => a.kind === "jd");
  const materialsHint = tCols("materials.reveal", { count: attachments.length });

  const flip = (key: IntakeColumnKey) => {
    setOpen((prev) => {
      const next = toggleColumn(prev, key);
      storeColumns(STORAGE_KEY, next);
      return next;
    });
  };

  // One intent, reachable from the composer glyph and from the folded zone: show
  // the materials. Only ever ADDS the draft zone, so the min-one-open guard is
  // irrelevant here.
  const revealMaterials = () => {
    setMaterialsOpen(true);
    setOpen((prev) => {
      if (prev.includes("draft")) return prev;
      const next = toggleColumn(prev, "draft");
      storeColumns(STORAGE_KEY, next);
      return next;
    });
  };

  // Each zone reports its OWN content — the numeral is the one fact a folded
  // zone still owes the reader, and the draft is a document, so it gets a state
  // mark rather than a meaningless number.
  const countOf = (key: IntakeColumnKey): { count: string; hint: string } => {
    if (key === "chat") return { count: String(active.transcript.length), hint: tCols("badge.turns", { count: active.transcript.length }) };
    if (key === "brief") {
      const n = briefItemCount(active.brief ?? null);
      return { count: String(n), hint: tCols("badge.briefItems", { count: n }) };
    }
    if (promotable) return { count: "✓", hint: tCols("badge.draftReady") };
    if (started) return { count: "…", hint: tCols("badge.draftDrafting") };
    return { count: "·", hint: tCols("badge.draftEmpty") };
  };

  return (
    // ONE PLANE. The overlay's modal body already bounds the height (92dvh), so
    // the desk fills it and never claims one of its own; below xl the zones stack
    // and the dialog scrolls.
    <div className="flex min-h-0 shrink-0 flex-col xl:h-full xl:flex-1 xl:shrink xl:flex-row xl:items-stretch">
      {ZONES.map((key, i) => {
        const isOpen = open.includes(key);
        const { count, hint } = countOf(key);
        return (
          <AtelierZone
            key={key}
            zoneKey={key}
            label={tCols(`col.${key}`)}
            count={count}
            countHint={hint}
            open={isOpen}
            canFold={!(isOpen && open.length === 1)}
            onToggle={() => flip(key)}
            busy={logic.sending && key !== "chat"}
            first={i === 0}
            grow={key === "chat" ? "xl:flex-[1.5]" : "xl:flex-1"}
            scroll={key !== "chat"}
          >
            {key === "chat" ? (
              <>
                <AtelierTranscript
                  transcript={active.transcript}
                  sending={logic.sending}
                  closed={closed}
                  onSend={logic.send}
                  onDeclineChoices={() => composerRef.current?.focus()}
                  highlightTurn={logic.highlightTurn}
                  onHighlightDone={logic.clearHighlight}
                  statusNote={scanNote}
                />
                {/* A closed session has no composer at all — the classic coat
                    printed a placeholder sentence into a dead field instead. */}
                {!closed ? (
                  <AtelierComposer
                    intakeId={active.id}
                    lang={active.lang ?? "en"}
                    transcript={active.transcript}
                    sending={logic.sending}
                    onSend={logic.send}
                    onOpenMaterials={revealMaterials}
                    materialsHint={materialsHint}
                    focusRef={composerRef}
                    voiceSlot={
                      <JdsIntakeVoice
                        intakeId={active.id}
                        disabled={logic.sending}
                        transcript={active.transcript}
                        onExchange={logic.applyVoiceExchange}
                        onSweep={logic.applyVoiceResult}
                      />
                    }
                  />
                ) : null}
              </>
            ) : key === "brief" ? (
              <AtelierBriefPlane
                brief={active.brief}
                intakeId={active.id}
                updatedAt={active.updatedAt}
                frozen={frozen}
                saving={logic.savingBrief}
                onSaveBrief={frozen ? undefined : logic.saveBrief}
                onJumpToTurn={logic.jumpToTurn}
                appMasterSlot={
                  active.shape === "app_master" ? (
                    <JdsIntakeAppMasterCard
                      dossier={active.dossier}
                      appMaster={active.appMaster}
                      specVintage={appMaster.specVintage}
                      scanNote={scanNote}
                      fenceNote={fenceNote}
                      objectiveCount={objectiveCount}
                      composing={appMaster.composing}
                      composeError={appMaster.composeError}
                      onCompose={frozen ? undefined : appMaster.composeAppMaster}
                      onCancelCompose={appMaster.cancelCompose}
                      onCancelScan={appMaster.cancelScan ?? undefined}
                      frozen={frozen}
                      paired={appMaster.paired}
                      dispatchState={appMaster.dispatchState}
                      onDispatch={frozen ? undefined : appMaster.dispatchAppMaster}
                    />
                  ) : null
                }
              />
            ) : (
              <div className="space-y-5 pb-2">
                {/* A consequence, not chrome: promoting over an attached JD
                    replaces it, and the requestor must know that before the
                    click. */}
                {hasJdAttachment ? <p className="text-meta text-steel">{t("draft.supersedeNote")}</p> : null}
                <AtelierDraftSheet brief={active.brief} />
                {/* Reference matter folds under the document it feeds — a
                    hairline and a glyph, not a bordered card inside a card. */}
                <details
                  open={materialsOpen}
                  onToggle={(e) => setMaterialsOpen(e.currentTarget.open)}
                  className="border-t border-stone-200 pt-2"
                >
                  <summary className={`focus-ring flex cursor-pointer list-none items-center gap-2 ${META_LABEL} transition-colors hover:text-ink`}>
                    <Paperclip size={13} aria-hidden />
                    {tCols("col.materials")}
                    <span className="text-sm text-stone-400 nums">{attachments.length}</span>
                  </summary>
                  <div className="mt-3">
                    <JdsIntakeAttachmentsPane
                      quietEmpty
                      attachments={attachments}
                      frozen={frozen}
                      saving={logic.savingAttachment}
                      onAdd={logic.addAttachment}
                      onRemove={logic.removeAttachment}
                      showTitle={false}
                    />
                  </div>
                </details>
              </div>
            )}
          </AtelierZone>
        );
      })}
    </div>
  );
}
