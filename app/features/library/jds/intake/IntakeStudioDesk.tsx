"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import { briefDraftHasContent } from "@/app/_lib/intake-draft";
import { briefItemCount } from "./jdsIntakeBriefModel";
import { JdsIntakeAppMasterCard } from "./JdsIntakeAppMasterCard";
import { JdsIntakeAttachmentsPane } from "./JdsIntakeAttachmentsPane";
import { JdsIntakeBriefPanel } from "./JdsIntakeBriefPanel";
import { JdsIntakeChat } from "./JdsIntakeChat";
import { JdsIntakeDraftPane } from "./JdsIntakeDraftPane";
import { JdsIntakeLayoutTriptych } from "./JdsIntakeLayoutTriptych";
import { JdsIntakeVoice } from "./JdsIntakeVoice";
import type { useAppMasterLogic } from "./jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession } from "./jdsIntakeLogic";

// THE DESK — the studio's working surface: the Triptych at full size.
//
// It is the same three leaves the tab used to host (JD draft · conversation ·
// live brief, materials folded under the draft) with one difference that is
// structural rather than cosmetic: the desk no longer picks its own height. In
// the tab it was a block on a scrolling page and had to guess one
// (`clamp(28rem, 100dvh - 15rem, 48rem)` — a guess that had to leave room for a
// page it could not see). Here the container IS the height: the overlay's modal
// body, already bounded at 92dvh, so the desk takes `fill` and the leaves get the
// whole dialog. That is the entire reason the studio exists — the conversation,
// the brief and the document are one workspace, and on a 1280px screen they were
// sharing about half a viewport with a tab header, a mode switcher and a page
// intro.
//
// This file is assembly only. Every pane is the component that already drew it;
// nothing about their contract changed.

export function IntakeStudioDesk({
  active,
  logic,
  appMaster,
}: {
  active: IntakeSession;
  logic: IntakeLogic;
  appMaster: ReturnType<typeof useAppMasterLogic>;
}) {
  const t = useTranslations("library.tab.intake");
  const closed = active.status !== "open";
  const frozen = active.status === "promoted";
  // The same computation the promote gate reads, so the draft spine's readiness
  // marker and the disabled button can never disagree (UAT L2-RC-1).
  const ready = briefPromoteBlockers(active.brief).length === 0;
  const scanNote = appMaster.scanState ? t(`appMaster.scan.${appMaster.scanState}`) : null;
  const fenceNote = appMaster.scanFence ? t(`appMaster.scan.${appMaster.scanFence}`) : null;
  const objectiveCount = (active.brief?.facets ?? []).filter((f) => f.key?.startsWith("objective:")).length;

  return (
    <JdsIntakeLayoutTriptych
      fill
      // While a turn is in flight the reply will rewrite exactly these two
      // leaves. The conversation says so itself (the thinking bubble), so it is
      // not in the list.
      busyColumns={logic.sending ? ["brief", "draft"] : []}
      chat={
        <JdsIntakeChat
          intakeId={active.id}
          lang={active.lang ?? "en"}
          transcript={active.transcript}
          sending={logic.sending}
          closed={closed}
          onSend={logic.send}
          voiceSlot={
            !closed ? (
              <JdsIntakeVoice
                intakeId={active.id}
                disabled={logic.sending}
                transcript={active.transcript}
                onExchange={logic.applyVoiceExchange}
                onSweep={logic.applyVoiceResult}
              />
            ) : null
          }
          highlightTurn={logic.highlightTurn}
          onHighlightDone={logic.clearHighlight}
          statusNote={scanNote}
        />
      }
      brief={
        <JdsIntakeBriefPanel
          brief={active.brief}
          intakeId={active.id}
          updatedAt={active.updatedAt}
          frozen={frozen}
          saving={logic.savingBrief}
          onSaveBrief={frozen ? undefined : logic.saveBrief}
          onJumpToTurn={logic.jumpToTurn}
          showTitle={false}
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
      }
      draftChip={<span className={`${CHIP_QUIET} shrink-0`}>{t("draft.workingChip")}</span>}
      draft={<JdsIntakeDraftPane brief={active.brief} attachments={active.attachments ?? []} />}
      materials={
        <JdsIntakeAttachmentsPane
          attachments={active.attachments ?? []}
          frozen={frozen}
          saving={logic.savingAttachment}
          onAdd={logic.addAttachment}
          onRemove={logic.removeAttachment}
          showTitle={false}
        />
      }
      counts={{
        turns: active.transcript.length,
        // Count what the brief HOLDS and what the panel actually renders
        // (UAT L2-CONV-1): `requirements` alone badged 0 over a full brief.
        briefItems: briefItemCount(active.brief ?? null),
        attachments: (active.attachments ?? []).length,
        draftReady: briefDraftHasContent(active.brief),
        draftPromotable: ready,
      }}
    />
  );
}
