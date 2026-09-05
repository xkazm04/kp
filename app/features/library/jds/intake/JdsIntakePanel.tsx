"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { briefPromoteBlockers } from "@/app/_lib/intake-brief";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// The SAME classifier the companion dock uses on the same raw diagnostic - the
// two surfaces read one Python fallback vocabulary, so they get one parser.
import { companionFallbackClass } from "@/app/_lib/companion-turn";
import { briefDraftHasContent } from "@/app/_lib/intake-draft";
import { briefItemCount } from "./jdsIntakeBriefModel";
import { JdsIntakeAppMasterCard } from "./JdsIntakeAppMasterCard";
import { JdsIntakeAppMasterStart } from "./JdsIntakeAppMasterStart";
import { JdsIntakeAttachmentsPane } from "./JdsIntakeAttachmentsPane";
import { JdsIntakeBriefPanel } from "./JdsIntakeBriefPanel";
import { JdsIntakeChat } from "./JdsIntakeChat";
import { JdsIntakeDraftPane } from "./JdsIntakeDraftPane";
import { JdsIntakeLayoutTriptych } from "./JdsIntakeLayoutTriptych";
import { JdsIntakeSessionsTable } from "./JdsIntakeSessionsTable";
import { JdsIntakeVoice } from "./JdsIntakeVoice";
import { useAppMasterLogic } from "./jdsIntakeAppMaster";
import { useIntakeLogic } from "./jdsIntakeLogic";
import { intakeLang } from "@/app/_lib/intake-lang";

// Role-intake dialog surface (docs/concepts/role-intake-dialog.md, Phase 1):
// a coaching-register conversation with the requestor on the left, the live
// RoleBrief filling in on the right, and Promote → the existing backgrounded
// JD build. Ledger of past sessions when none is open.

// One class string for every refusal line on this surface (recipes.ts holds the
// shared surfaces; this is local enough to stay here).
const RED = "text-body text-red-700";

const SHAPE_KEY = {
  power_unit: "shape.powerUnit",
  story: "shape.story",
  app_master: "shape.appMaster",
} as const;

export function JdsIntakePanel({ onPromoted }: { onPromoted?: () => void }) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  // An API failure is shown from its machine `code`, never from the server's
  // English `error` string (docs/architecture/api-contracts.md §1.1).
  const resolveError = useErrorMessage();
  const {
    sessions,
    active,
    sending,
    creating,
    promoting,
    degraded,
    degradation,
    error,
    startNew,
    startAppMaster,
    applySession,
    openSession,
    closeSession,
    send,
    promote,
    voiceNote,
    applyVoiceResult,
    applyVoiceExchange,
    saveBrief,
    savingBrief,
    reopen,
    reopening,
    highlightTurn,
    jumpToTurn,
    clearHighlight,
    addAttachment,
    removeAttachment,
    savingAttachment,
  } = useIntakeLogic(onPromoted);
  // App master (docs/features/app-master/README.md): the scan watcher lives
  // HERE, not in useIntakeLogic — it needs the shared TasksProvider as its clock,
  // and importing that provider into the logic module would drag React and
  // next-intl into its node:test unit run. Called before the ledger early-return
  // so the hook order is stable across both branches.
  const {
    scanState,
    scanFence,
    cancelScan,
    composeAppMaster,
    cancelCompose,
    composing,
    composeError,
    paired,
    dispatchState,
    dispatchAppMaster,
    specVintage,
  } = useAppMasterLogic(active, applySession);
  const reduced = useReducedMotion();
  // Work-sample case design at promote — explicit opt-in (JD-builder checklist semantics).
  const [withCase, setWithCase] = useState(false);
  // Market salary research at promote (UAT L1-HRBP-11): the route's opt-out was
  // API-only, so a non-Czech role could not decline the Czech-market comp read.
  // Opt-OUT, not opt-in — default true preserves the shipped behaviour.
  const [withMarket, setWithMarket] = useState(true);

  if (!active) {
    // Ledger ⇄ session is a full content swap on one surface, so each side fades
    // in on arrival: the two views are different shapes, and swapping them in a
    // single frame reads as the panel being replaced rather than navigated.
    return (
      <div className={`${PANEL} animate-fade-in p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* The lede is a tooltip on the title, not a paragraph under it: it
              explains the surface to a first-time reader and then repeats itself
              on every visit above the one thing a returning reader came for. */}
          <div className={`${META_LABEL} cursor-help underline decoration-stone-300 decoration-dotted underline-offset-4`} title={t("lede")}>
            {t("ledgerTitle")}
          </div>
          <button
            type="button"
            className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
            disabled={creating}
            onClick={() => startNew(intakeLang(locale))}
          >
            {creating ? t("starting") : t("new")}
          </button>
        </div>
        {/* App master (docs/features/app-master/README.md): the third shape does
            not start from a blank conversation — it starts from an APP. */}
        <JdsIntakeAppMasterStart
          busy={creating}
          onStart={(repo) => startAppMaster(intakeLang(locale), repo)}
        />
        {error ? (
          <p className="mt-3 text-body text-red-700">
            {resolveError(error, t(error.kind === "appMaster" ? "appMaster.startError" : "error"))}
          </p>
        ) : null}
        {/* Keyed on the loaded state, so the ledger fades in when the fetch
            lands (the key changes null → "loaded") instead of appearing under
            the placeholder it replaces. */}
        <div key={sessions === null ? "loading" : "loaded"} className="animate-arrive-in">
          {sessions === null ? (
            <div className="reveal-quiet mt-4 min-h-[6rem]" aria-hidden />
          ) : (
            <JdsIntakeSessionsTable sessions={sessions} onOpen={openSession} />
          )}
        </div>
      </div>
    );
  }

  const closed = active.status !== "open";
  // UAT L2-RC-1 — the gate must say what it is waiting for. `blockers` is the
  // same computation `ready` is derived from, so the spine marker, the button
  // and its hint can never disagree again.
  const blockers = briefPromoteBlockers(active.brief);
  const ready = blockers.length === 0;
  // The scan line the chat shows under the opener while the codebase is read.
  // Cleared the moment the dossier lands — the card then speaks for itself.
  const scanNote = scanState ? t(`appMaster.scan.${scanState}`) : null;
  // A SECOND line, not a replacement: an unverified fence is true of a scan that
  // otherwise completed cleanly, and folding it into scanNote would mean one of the
  // two disclosures was always dropped.
  const fenceNote = scanFence ? t(`appMaster.scan.${scanFence}`) : null;
  const objectiveCount = (active.brief?.facets ?? []).filter((f) => f.key?.startsWith("objective:")).length;
  const promoteHint = ready ? undefined : blockers.map((b) => t(`promoteMissing.${b}`)).join(" ");

  // The degraded line says WHICH degradation. "No model configured" is a
  // settings trip; "the model did not answer" is worth one retry; an
  // unrecognised diagnostic keeps the generic sentence rather than being
  // guessed at. Pre-fix all three read "AI is offline, so the guided checklist
  // runs instead" and an operator on a keyless install retried forever.
  const fallbackClass = degradation ? companionFallbackClass(degradation.reason) : null;
  const degradedText =
    fallbackClass === "noProvider"
      ? t("degradedNoProvider")
      : fallbackClass === "providerFailed"
        ? t("degradedProviderFailed")
        : t("degradedNote");
  // The scripted path is written in four locales; a session opened in a fifth is
  // SERVED one of them. Intl.DisplayNames names it in the reader's own language,
  // so no catalog carries a list of language names.
  const standInLanguage =
    degradation?.lang && degradation.lang !== locale
      ? t("standInLanguage", {
          language: new Intl.DisplayNames([locale], { type: "language" }).of(degradation.lang) ?? degradation.lang,
        })
      : null;

  return (
    <div className={`${PANEL} animate-fade-in p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Leaving the session is a NAVIGATION back to the ledger, so it reads
              as one: a bordered control with the arrow pointing the way out. As a
              borderless ghost beside the session title it looked like a label. */}
          <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} onClick={closeSession}>
            <ArrowLeft size={14} aria-hidden /> {t("back")}
          </button>
          <span className="text-body font-medium text-ink">{active.title || t("untitled")}</span>
          {active.shape ? <span className={CHIP_QUIET}>{t(SHAPE_KEY[active.shape])}</span> : null}
          <span className={CHIP_QUIET}>{t(`status.${active.status}`)}</span>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton active={active} />
          {active.status === "complete" ? (
            // Re-open (UAT drain §2.1): a completed session can take another
            // thought; the server appends a system turn so the record is honest.
            <button
              type="button"
              className={`${BTN_GHOST} h-9 px-3 text-sm`}
              disabled={reopening}
              onClick={() => reopen(t("reopen.note"))}
            >
              {t("reopen.button")}
            </button>
          ) : null}
          {active.status === "promoted" && active.jdSlug ? (
            <span className="text-body text-moss">{t("promoted")}</span>
          ) : (
            <>
              {/* Same checklist semantics as the JD builder: the work-sample case
                  is an explicit opt-in, designed from this same brief. */}
              <label className="flex cursor-pointer items-center gap-1.5 text-meta text-steel">
                <input
                  type="checkbox"
                  className="accent-coral"
                  checked={withCase}
                  onChange={(e) => setWithCase(e.target.checked)}
                  disabled={promoting}
                />
                {t("promoteCase")}
              </label>
              {/* UAT L1-HRBP-11 — the handle Priya could read in the route and
                  not press. Checked = the market band is researched (default). */}
              <label className="flex cursor-pointer items-center gap-1.5 text-meta text-steel">
                <input
                  type="checkbox"
                  className="accent-coral"
                  checked={withMarket}
                  onChange={(e) => setWithMarket(e.target.checked)}
                  disabled={promoting}
                />
                {t("promoteMarket")}
              </label>
              <button
                type="button"
                className={`${BTN_SECONDARY} h-9 px-4 text-sm`}
                disabled={!ready || promoting}
                onClick={() => promote({ caseDesign: withCase, marketResearch: withMarket })}
                title={promoteHint}
              >
                {promoting ? t("promoting") : t("promote")}
              </button>
            </>
          )}
        </div>
      </div>
      {/* Status/error lines fade in and out (reduced motion: instant). */}
      <AnimatePresence initial={false}>
        {[
          degraded ? { key: "degraded", cls: "text-meta text-steel", text: degradedText } : null,
          // The stand-in language is its own fact, not a flavour of the one
          // above: the checklist DID answer, just not in the language this
          // session was opened in, and only the reader can decide that matters.
          standInLanguage ? { key: "standIn", cls: "text-meta text-steel", text: standInLanguage } : null,
          voiceNote === "stored" ? { key: "voiceStored", cls: "text-meta text-steel", text: t("voice.storedNote") } : null,
          // The server's refusal CODE decides the sentence; the per-affordance
          // string below is only the fallback for a failure that carries none (an
          // offline fetch). Five different refusals used to share one line each.
          error?.kind === "send" ? { key: "send", cls: RED, text: resolveError(error, t("sendError")) } : null,
          error?.kind === "promote" ? { key: "promote", cls: RED, text: resolveError(error, t("promoteError")) } : null,
          error?.kind === "saveBrief" ? { key: "saveBrief", cls: RED, text: resolveError(error, t("edit.saveError")) } : null,
          error?.kind === "reopen" ? { key: "reopen", cls: RED, text: resolveError(error, t("reopen.error")) } : null,
          error?.kind === "attachment" ? { key: "attachment", cls: RED, text: resolveError(error, t("attachments.error")) } : null,
        ]
          .filter((n): n is { key: string; cls: string; text: string } => n !== null)
          .map((n) => (
            <motion.p
              key={n.key}
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              className={`mt-2 ${n.cls}`}
            >
              {n.text}
            </motion.p>
          ))}
      </AnimatePresence>
      {/* The Triptych session layout (prototype-round winner, consolidated):
          three foldable leaves — JD draft · conversation · live brief. */}
      <JdsIntakeLayoutTriptych
        chat={
          <JdsIntakeChat
            transcript={active.transcript}
            sending={sending}
            closed={closed}
            onSend={send}
            voiceSlot={
              !closed ? (
                <JdsIntakeVoice
                  intakeId={active.id}
                  disabled={sending}
                  transcript={active.transcript}
                  onExchange={applyVoiceExchange}
                  onSweep={applyVoiceResult}
                />
              ) : null
            }
            highlightTurn={highlightTurn}
            onHighlightDone={clearHighlight}
            statusNote={scanNote}
          />
        }
        brief={
          <JdsIntakeBriefPanel
            brief={active.brief}
            intakeId={active.id}
            updatedAt={active.updatedAt}
            frozen={active.status === "promoted"}
            saving={savingBrief}
            onSaveBrief={active.status !== "promoted" ? saveBrief : undefined}
            onJumpToTurn={jumpToTurn}
            showTitle={false}
            appMasterSlot={
              active.shape === "app_master" ? (
                <JdsIntakeAppMasterCard
                  dossier={active.dossier}
                  appMaster={active.appMaster}
                  specVintage={specVintage}
                  scanNote={scanNote}
                  fenceNote={fenceNote}
                  objectiveCount={objectiveCount}
                  composing={composing}
                  composeError={composeError}
                  onCompose={active.status !== "promoted" ? composeAppMaster : undefined}
                  onCancelCompose={cancelCompose}
                  onCancelScan={cancelScan ?? undefined}
                  frozen={active.status === "promoted"}
                  paired={paired}
                  dispatchState={dispatchState}
                  onDispatch={active.status !== "promoted" ? dispatchAppMaster : undefined}
                />
              ) : null
            }
          />
        }
        draftChip={<span className={`${CHIP_QUIET} shrink-0`}>{t("draft.workingChip")}</span>}
        draft={
          <JdsIntakeDraftPane brief={active.brief} attachments={active.attachments ?? []} />
        }
        materials={
          <JdsIntakeAttachmentsPane
            attachments={active.attachments ?? []}
            frozen={active.status === "promoted"}
            saving={savingAttachment}
            onAdd={addAttachment}
            onRemove={removeAttachment}
            showTitle={false}
          />
        }
        counts={{
          turns: active.transcript.length,
          // UAT L2-CONV-1: `requirements` alone badged 0 over a brief holding a
          // title, a seniority, seven facets and two 90-day criteria — the
          // extraction rarely fills requirements[]. Count what the brief holds —
          // and, since the panel now drops facets that merely repeat a 90-day
          // criterion, count what it actually RENDERS (jdsIntakeBriefModel), so
          // the folded spine can't promise an item the open leaf never shows.
          briefItems: briefItemCount(active.brief ?? null),
          attachments: (active.attachments ?? []).length,
          // UAT L1-EVA-10 / L1-HRBP-15: computed since the Triptych shipped and
          // never consumed — the draft spine now reads it.
          draftReady: briefDraftHasContent(active.brief),
          // UAT L2-RC-1: "ready" on the spine must mean the promote gate agrees,
          // not merely that the draft pane has something in it.
          draftPromotable: ready,
        }}
      />
    </div>
  );
}

// The director/inspector artifact (UAT drain §2.2): brief + numbered transcript
// + provenance as one markdown download, built client-side from the session.
function ExportButton({ active }: { active: NonNullable<ReturnType<typeof useIntakeLogic>["active"]> }) {
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
