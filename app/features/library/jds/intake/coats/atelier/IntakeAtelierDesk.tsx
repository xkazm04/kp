"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { dictationLang } from "@/app/_lib/intake-lang";
import { Paperclip } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { StudioComposer, StudioDesk, StudioTranscript, StudioVoiceBar, useStudioComposerDraft } from "@/app/_components/studio";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { briefDraftHasContent } from "@/app/_lib/intake-draft";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import { briefItemCount } from "../../jdsIntakeBriefModel";
import { INTAKE_AUTO_SPEAK_KEY } from "../../intakeVoiceIo";
import { JdsIntakeAppMasterCard } from "../../JdsIntakeAppMasterCard";
import { JdsIntakeAttachmentsPane } from "../../JdsIntakeAttachmentsPane";
import { JdsIntakeVoice } from "../../JdsIntakeVoice";
import { INTAKE_COLUMNS_STORAGE_KEY, readStoredColumns, storeColumns, toggleColumn, type IntakeColumnKey } from "../studioContract";
import type { useAppMasterLogic } from "../../jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession, IntakeTurn } from "../../jdsIntakeLogic";
import { AtelierBriefPlane } from "./AtelierBriefPlane";
import { AtelierDraftSheet } from "./AtelierDraftSheet";

// THE INTAKE DESK — the Studio kit, with intake's plane on it.
//
// This was the `atelier` direction of a three-way prototype; it won, became the
// studio's only working surface, and in WP1 the surface itself — the zones, the
// fold, the transcript blocks, the bare composer, the voice pair, the decision
// cards — was extracted into `app/_components/studio` so the job-seeker dialogs
// can stand on the same desk. What is left here is COMPOSITION: which zones
// intake has and in what order, what its plane is (the live brief, with the
// App-master card when the session has that shape), what its extra zone holds
// (the JD draft over the materials disclosure), what each zone's numeral means,
// and the wiring from `IntakeLogic` into the kit's props. Nothing in this file
// draws chrome; if it needs to, the kit is where the drawing belongs.
//
// The variant is PROPS, not a coat: `ns` is intake's catalog branch, the storage
// keys are intake's, the plane is a ReactNode. The doctrine the surface obeys —
// NO SENTENCE OCCUPIES LAYOUT — is stated in the kit (studioZones.ts).

const ZONES = ["draft", "chat", "brief"] as const satisfies readonly IntakeColumnKey[];
const DEFAULT_OPEN: IntakeColumnKey[] = ["draft", "chat", "brief"];
const NS = "library.tab.intake";

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
  const viewerLocale = useLocale();
  // Controlled: the paperclip glyph opens the draft zone from OUTSIDE the desk,
  // so intake holds the open set and persists it with the kit's own helpers.
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(INTAKE_COLUMNS_STORAGE_KEY, DEFAULT_OPEN));
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

  const persist = (next: IntakeColumnKey[]) => {
    setOpen(next);
    storeColumns(INTAKE_COLUMNS_STORAGE_KEY, next);
  };

  // One intent, reachable from the composer glyph and from the folded zone: show
  // the materials. Only ever ADDS the draft zone, so the min-one-open guard is
  // irrelevant here.
  const revealMaterials = () => {
    setMaterialsOpen(true);
    if (!open.includes("draft")) persist(toggleColumn(open, "draft"));
  };

  // Each zone reports its OWN content — the numeral is the one fact a folded
  // zone still owes the reader, and the draft is a document, so it gets a state
  // mark rather than a meaningless number.
  const draftMark = promotable
    ? { count: "✓", countHint: tCols("badge.draftReady") }
    : started
      ? { count: "…", countHint: tCols("badge.draftDrafting") }
      : { count: "·", countHint: tCols("badge.draftEmpty") };
  const briefCount = briefItemCount(active.brief ?? null);
  const meta = {
    chat: { count: String(active.transcript.length), countHint: tCols("badge.turns", { count: active.transcript.length }) },
    brief: { count: String(briefCount), countHint: tCols("badge.briefItems", { count: briefCount }) },
    draft: draftMark,
  };

  // The agent's newest line, for read-aloud. Null while a turn is in flight —
  // the reply on screen is the PREVIOUS one, and speaking it while the next is
  // being written would read the conversation back out of order.
  const speakText = useMemo(() => latestAgentLine(active.transcript, logic.sending), [active.transcript, logic.sending]);

  return (
    <StudioDesk<IntakeColumnKey>
      ns={NS}
      zones={{ keys: ZONES, storageKey: INTAKE_COLUMNS_STORAGE_KEY, pinned: [] }}
      open={open}
      onOpenChange={persist}
      transcriptZone="chat"
      planeZone="brief"
      sending={logic.sending}
      meta={meta}
      transcript={
        <StudioTranscript
          ns={NS}
          turns={active.transcript}
          latestIndex={active.transcript.length > 0 ? active.transcript.length - 1 : null}
          sending={logic.sending}
          closed={closed}
          onPick={logic.send}
          onDecline={() => composerRef.current?.focus()}
          highlightTurn={logic.highlightTurn}
          onHighlightDone={logic.clearHighlight}
          statusNote={scanNote}
        />
      }
      composer={
        // A closed session has no composer at all — the classic coat printed a
        // placeholder sentence into a dead field instead.
        !closed ? (
          <StudioComposer
            ns={NS}
            onSend={logic.send}
            disabled={false}
            sending={logic.sending}
            draftKey={`kp-intake-draft:${active.id}`}
            focusRef={composerRef}
            leading={<IconAction icon={Paperclip} label={t("glyph.materials")} hint={materialsHint} onClick={revealMaterials} />}
            voiceSlot={<IntakeDictationSlot lang={dictationLang(active.lang, viewerLocale)} sessionKey={active.id} speakText={speakText} disabled={logic.sending} />}
            actions={
              <JdsIntakeVoice
                intakeId={active.id}
                disabled={logic.sending}
                transcript={active.transcript}
                onExchange={logic.applyVoiceExchange}
                onSweep={logic.applyVoiceResult}
              />
            }
          />
        ) : null
      }
      plane={
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
      }
      extra={{
        draft: (
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
        ),
      }}
    />
  );
}

/** The newest agent turn with text, or null while a reply is in flight. */
function latestAgentLine(transcript: IntakeTurn[], sending: boolean): string | null {
  if (sending) return null;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const turn = transcript[i];
    if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
  }
  return null;
}

/** Intake's dictation pair, wired into the kit composer's draft: dictated words
 *  APPEND through the composer's own handle and never send. Lives inside the
 *  composer's slot, which is what gives it `useStudioComposerDraft()`. */
function IntakeDictationSlot({
  lang,
  sessionKey,
  speakText,
  disabled,
}: {
  lang: string;
  sessionKey: string;
  speakText: string | null;
  disabled: boolean;
}) {
  const draft = useStudioComposerDraft();
  return (
    <StudioVoiceBar
      ns={NS}
      lang={lang}
      sessionKey={sessionKey}
      speakText={speakText}
      disabled={disabled}
      autoSpeakStorageKey={INTAKE_AUTO_SPEAK_KEY}
      onDictation={draft.append}
    />
  );
}
