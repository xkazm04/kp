"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CHIP_QUIET, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import { IconAction } from "../IconAction";
import { JdsIntakeAppMasterCard } from "../../JdsIntakeAppMasterCard";
import { useBriefReveal } from "../../BriefRevealAtoms";
import { useArrivalDelta } from "../../IntakeArrivalMotion";
import { buildBriefSections, sectionLineKeys } from "../../briefSections";
import { readStoredColumns, storeColumns, toggleColumn, type IntakeColumnKey } from "../../intakeLayoutShared";
import type { useAppMasterLogic } from "../../jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession } from "../../jdsIntakeLogic";
import { ConsoleComposer } from "./ConsoleComposer";
import { ConsoleDossier } from "./ConsoleDossier";
import { ConsolePromptStage } from "./ConsolePromptStage";
import { ConsoleSheet } from "./ConsoleSheet";
import { ConsoleTimelineRail } from "./ConsoleTimelineRail";
import { buildExchanges, currentExchange, exchangeForTurn, CONSOLE_COLUMNS_KEY } from "./consoleModel";

// THE CONSOLE COAT — an instrument for one question at a time.
//
// Same three zones as the classic desk, because the information architecture is
// right: the conversation, the record it builds, and the document it produces.
// Everything INSIDE them is a different component, because the classic desk
// answers "what has been said" and this one answers "what is being asked".
//
//   conversation → a timeline RAIL of turn ticks beside a PROMPT STAGE. The
//                  current question is the hero at reading size; every earlier
//                  exchange is one tick, reachable in one press. History is
//                  available, not the default view.
//   brief        → a DOSSIER of declared stacks. Each captured condition is a
//                  card that LANDS on its stack; an empty stack draws its own
//                  outline.
//   draft        → a SHEET: paper edge, display headings, reading measure, and a
//                  newly written section unfolding into place.
//
// The zones fold to their own spines under this coat's OWN storage key — the
// triptych's key belongs to a layout with different columns, and sharing it
// would let one coat fold the other's.
//
// NO SENTENCE OCCUPIES LAYOUT (coatKit's rule). Every empty region here draws the
// shape of what will fill it, every absent capability is its own negative glyph
// with the reason in a tooltip, and every option is a pressed icon. What is NOT
// hidden: an error the requestor must act on, and the degraded-engine notice —
// both of which the studio overlay renders above this desk, where they belong.

const DEFAULT_OPEN: IntakeColumnKey[] = ["chat", "brief", "draft"];

/** One zone of the rack: a titled, bounded, independently scrolling column that
 *  folds to a spine. The spine still reports what the zone holds — a fold must
 *  never cost the reader the fact that something is in there. */
function ConsoleZone({
  label,
  badge,
  open,
  canFold,
  onToggle,
  grow,
  children,
}: {
  label: string;
  badge: string;
  open: boolean;
  canFold: boolean;
  onToggle: () => void;
  grow: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  if (!open) {
    return (
      <section className={`${PANEL_SUNKEN} flex shrink-0 flex-col items-center gap-3 px-1.5 py-3 xl:w-11`}>
        <IconAction icon={ChevronRight} label={t("expand")} hint={label} onClick={onToggle} side="right" />
        <span className={`${CHIP_QUIET} nums`}>{badge}</span>
        <span className="min-w-0 text-meta uppercase text-stone-400 xl:[writing-mode:vertical-rl]">{label}</span>
      </section>
    );
  }
  return (
    <section
      className={`${PANEL} flex min-w-0 flex-col overflow-hidden p-4 ${grow} max-h-[60dvh] xl:max-h-none dark:rounded-2xl dark:shadow-sticker-sm`}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 truncate ${META_LABEL}`}>{label}</span>
          <span className={`${CHIP_QUIET} nums`}>{badge}</span>
        </span>
        {canFold ? <IconAction icon={ChevronLeft} label={t("collapse")} hint={label} onClick={onToggle} /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  );
}

export function IntakeConsoleDesk({
  active,
  logic,
  appMaster,
}: {
  active: IntakeSession;
  logic: IntakeLogic;
  appMaster: ReturnType<typeof useAppMasterLogic>;
}) {
  const t = useTranslations("library.tab.intake");
  const tCol = useTranslations("library.tab.intake.columns.col");
  const closed = active.status !== "open";
  const frozen = active.status === "promoted";
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(CONSOLE_COLUMNS_KEY, DEFAULT_OPEN));
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  const [flashOpen, setFlashOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const flip = (key: IntakeColumnKey) =>
    setOpen((prev) => {
      const next = toggleColumn(prev, key);
      storeColumns(CONSOLE_COLUMNS_KEY, next);
      return next;
    });

  const exchanges = useMemo(() => buildExchanges(active.transcript), [active.transcript]);
  const current = currentExchange(exchanges);
  const lastIndex = active.transcript.length - 1;

  // A brief card's citation is this coat's best use of `highlightTurn`: instead
  // of scrolling a log to a bubble, it OPENS that exchange on the rail and
  // flashes it once. The handshake is the same — the studio hands us a turn, we
  // consume it and clear it, so a second press on the same citation works.
  const { highlightTurn, clearHighlight } = logic;
  useEffect(() => {
    if (highlightTurn == null) return;
    const found = exchangeForTurn(exchanges, highlightTurn);
    // Deferred a tick, the jdsHooks.ts pattern: no synchronous setState inside
    // an effect, and the clear has to happen either way — a citation pointing at
    // a turn this coat cannot show must still be consumed, or the studio would
    // hold it forever and the next press would be a no-op.
    const timer = window.setTimeout(() => {
      if (found) {
        setOpenTurn(found.index);
        setFlashOpen(true);
      }
      clearHighlight();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [highlightTurn, clearHighlight, exchanges]);

  const sections = useMemo(() => buildBriefSections(active.brief), [active.brief]);
  // Owned HERE, above the dossier, for the reason the classic panel owns them
  // above its body: they must keep classifying while the edit form is open, or
  // closing the form would read as a whole brief arriving at once.
  const reveal = useBriefReveal(sectionLineKeys(sections));
  const delta = useArrivalDelta(active.brief);

  // What read-aloud offers to speak: the agent's newest line, and nothing while a
  // turn is in flight — the reply on screen is the PREVIOUS one.
  const speakText = useMemo(() => {
    if (logic.sending) return null;
    for (let i = active.transcript.length - 1; i >= 0; i -= 1) {
      const turn = active.transcript[i];
      if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
    }
    return null;
  }, [active.transcript, logic.sending]);

  const ready = briefPromoteBlockers(active.brief).length === 0;
  const scanNote = appMaster.scanState ? t(`appMaster.scan.${appMaster.scanState}`) : null;
  const fenceNote = appMaster.scanFence ? t(`appMaster.scan.${appMaster.scanFence}`) : null;
  const objectiveCount = (active.brief?.facets ?? []).filter((f) => f.key?.startsWith("objective:")).length;
  const briefCards = sections.reduce((n, s) => n + s.lines.length, 0);
  const attachments = active.attachments ?? [];

  return (
    <div className="flex min-h-0 shrink-0 flex-col gap-3 xl:h-full xl:flex-1 xl:shrink xl:flex-row xl:items-stretch">
      <ConsoleZone
        label={tCol("chat")}
        badge={String(exchanges.length)}
        open={open.includes("chat")}
        canFold={open.length > 1}
        onToggle={() => flip("chat")}
        grow="xl:flex-[1.4]"
      >
        <div className="flex min-h-0 flex-1 gap-3">
          <ConsoleTimelineRail
            exchanges={exchanges}
            currentIndex={current?.index ?? null}
            openIndex={openTurn}
            onOpen={(index) => {
              setOpenTurn(index);
              setFlashOpen(false);
            }}
          />
          <ConsolePromptStage
            exchange={current}
            openExchange={openTurn === null ? null : (exchanges.find((ex) => ex.index === openTurn) ?? null)}
            flashOpen={flashOpen}
            sending={logic.sending}
            // Only the newest turn's card set answers the current question; an
            // older set stays visible as the record of what was offered.
            interactiveChoices={!closed && current?.index === lastIndex}
            onPick={logic.send}
            onDecline={() => composerRef.current?.focus()}
            composer={
              closed ? null : (
                <ConsoleComposer
                  intakeId={active.id}
                  lang={active.lang ?? "en"}
                  sending={logic.sending}
                  onSend={logic.send}
                  speakText={speakText}
                  transcript={active.transcript}
                  onExchange={logic.applyVoiceExchange}
                  onSweep={logic.applyVoiceResult}
                  textareaRef={composerRef}
                />
              )
            }
          />
          {scanNote ? (
            <span className="sr-only" role="status">
              {scanNote}
            </span>
          ) : null}
        </div>
      </ConsoleZone>

      <ConsoleZone
        label={tCol("brief")}
        badge={String(briefCards)}
        open={open.includes("brief")}
        canFold={open.length > 1}
        onToggle={() => flip("brief")}
        grow="xl:flex-1"
      >
        <ConsoleDossier
          brief={active.brief}
          sections={sections}
          intakeId={active.id}
          updatedAt={active.updatedAt}
          mode={reveal.mode}
          delta={delta}
          writing={reveal.writing}
          frozen={frozen}
          saving={logic.savingBrief}
          onSaveBrief={frozen ? undefined : logic.saveBrief}
          onJumpToTurn={logic.jumpToTurn}
          attachments={attachments}
          savingAttachment={logic.savingAttachment}
          onAddAttachment={logic.addAttachment}
          onRemoveAttachment={logic.removeAttachment}
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
      </ConsoleZone>

      <ConsoleZone
        label={tCol("draft")}
        // A document is ready or it is not; the promote gate's own computation
        // decides which glyph, so the badge can never claim a readiness the
        // disabled Create-JD button contradicts.
        badge={ready ? "✓" : "·"}
        open={open.includes("draft")}
        canFold={open.length > 1}
        onToggle={() => flip("draft")}
        grow="xl:flex-[1.2]"
      >
        <ConsoleSheet brief={active.brief} hasJdAttachment={attachments.some((a) => a.kind === "jd")} />
      </ConsoleZone>
    </div>
  );
}
