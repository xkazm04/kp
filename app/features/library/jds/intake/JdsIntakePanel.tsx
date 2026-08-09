"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { briefReadyToPromote } from "@/app/_lib/intake-brief";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, INTRO, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { briefDraftHasContent } from "@/app/_lib/intake-draft";
import { JdsIntakeAttachmentsPane } from "./JdsIntakeAttachmentsPane";
import { JdsIntakeBriefPanel } from "./JdsIntakeBriefPanel";
import { JdsIntakeChat } from "./JdsIntakeChat";
import { JdsIntakeDraftPane } from "./JdsIntakeDraftPane";
import { JdsIntakeLayoutCockpit } from "./JdsIntakeLayoutCockpit";
import { JdsIntakeLayoutTriptych } from "./JdsIntakeLayoutTriptych";
import { JdsIntakeSidePanel } from "./JdsIntakeSidePanel";
import { JdsIntakeVoice } from "./JdsIntakeVoice";
import { useIntakeLogic } from "./jdsIntakeLogic";

// Prototype round 1 (/prototype loop): the session layout is variant-switchable
// — "current" (baseline, default) vs two directional 3-column arrangements
// (Triptych spine-fold · Cockpit switchboard). Layout-only: every variant
// renders the SAME pane content nodes built below; the choice persists per
// browser. Throwaway scaffold — consolidation removes the switcher.
const LAYOUT_VARIANTS = ["current", "triptych", "cockpit"] as const;
type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];
const VARIANT_STORAGE = "kp-intake-proto-variant";

function readStoredVariant(): LayoutVariant {
  if (typeof window === "undefined") return "current";
  try {
    const raw = window.localStorage.getItem(VARIANT_STORAGE);
    return (LAYOUT_VARIANTS as readonly string[]).includes(raw ?? "") ? (raw as LayoutVariant) : "current";
  } catch {
    return "current";
  }
}

// Role-intake dialog surface (docs/concepts/role-intake-dialog.md, Phase 1):
// a coaching-register conversation with the requestor on the left, the live
// RoleBrief filling in on the right, and Promote → the existing backgrounded
// JD build. Ledger of past sessions when none is open.

export function JdsIntakePanel({ onPromoted }: { onPromoted?: () => void }) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  const {
    sessions,
    active,
    sending,
    creating,
    promoting,
    degraded,
    error,
    startNew,
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
  const reduced = useReducedMotion();
  // Work-sample case design at promote — explicit opt-in (JD-builder checklist semantics).
  const [withCase, setWithCase] = useState(false);
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>(() => readStoredVariant());
  const pickVariant = (v: LayoutVariant) => {
    setLayoutVariant(v);
    try {
      window.localStorage.setItem(VARIANT_STORAGE, v);
    } catch {
      /* preference just doesn't persist */
    }
  };

  if (!active) {
    return (
      <div className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={META_LABEL}>{t("ledgerTitle")}</div>
            <p className={`${INTRO} mt-1 max-w-2xl`}>{t("lede")}</p>
          </div>
          <button
            type="button"
            className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
            disabled={creating}
            onClick={() => startNew(locale === "cs" ? "cs" : "en")}
          >
            {creating ? t("starting") : t("new")}
          </button>
        </div>
        {error ? <p className="mt-3 text-body text-red-700">{t("error")}</p> : null}
        <div className="mt-4 space-y-2">
          {sessions === null ? (
            <div className="reveal-quiet min-h-[6rem]" aria-hidden />
          ) : sessions.length === 0 ? (
            <p className="text-body text-steel">{t("empty")}</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSession(s.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left hover:border-stone-400 dark:rounded-2xl"
              >
                <span className="text-body font-medium text-ink">{s.title || t("untitled")}</span>
                <span className="flex items-center gap-2">
                  {s.shape ? <span className={CHIP_QUIET}>{t(s.shape === "power_unit" ? "shape.powerUnit" : "shape.story")}</span> : null}
                  <span className={CHIP_QUIET}>{t(`status.${s.status}`)}</span>
                  <span className="text-meta text-steel nums">{t("turns", { count: s.turnCount })}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  const closed = active.status !== "open";
  const ready = briefReadyToPromote(active.brief);

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} onClick={closeSession}>
            {t("back")}
          </button>
          <span className="text-body font-medium text-ink">{active.title || t("untitled")}</span>
          {active.shape ? (
            <span className={CHIP_QUIET}>{t(active.shape === "power_unit" ? "shape.powerUnit" : "shape.story")}</span>
          ) : null}
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
              <button
                type="button"
                className={`${BTN_SECONDARY} h-9 px-4 text-sm`}
                disabled={!ready || promoting}
                onClick={() => promote({ caseDesign: withCase })}
                title={ready ? undefined : t("promoteHint")}
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
          degraded ? { key: "degraded", cls: "text-meta text-steel", text: t("degradedNote") } : null,
          voiceNote === "stored" ? { key: "voiceStored", cls: "text-meta text-steel", text: t("voice.storedNote") } : null,
          error === "send" ? { key: "send", cls: "text-body text-red-700", text: t("sendError") } : null,
          error === "promote" ? { key: "promote", cls: "text-body text-red-700", text: t("promoteError") } : null,
          error === "saveBrief" ? { key: "saveBrief", cls: "text-body text-red-700", text: t("edit.saveError") } : null,
          error === "reopen" ? { key: "reopen", cls: "text-body text-red-700", text: t("reopen.error") } : null,
          error === "attachment" ? { key: "attachment", cls: "text-body text-red-700", text: t("attachments.error") } : null,
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
      {/* Prototype switcher (session view only; throwaway scaffold). */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={META_LABEL}>{t("proto.label")}</span>
        <SegmentedControl
          label={t("proto.label")}
          value={layoutVariant}
          onChange={pickVariant}
          options={[
            { value: "current", label: t("proto.variantCurrent") },
            { value: "triptych", label: t("proto.variantTriptych") },
            { value: "cockpit", label: t("proto.variantCockpit") },
          ]}
        />
      </div>
      {(() => {
        const chatNode = (
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
          />
        );
        if (layoutVariant === "current") {
          return (
            <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
              {chatNode}
              <JdsIntakeSidePanel
                brief={active.brief}
                attachments={active.attachments ?? []}
                frozen={active.status === "promoted"}
                savingBrief={savingBrief}
                savingAttachment={savingAttachment}
                onSaveBrief={active.status !== "promoted" ? saveBrief : undefined}
                onJumpToTurn={jumpToTurn}
                onAddAttachment={addAttachment}
                onRemoveAttachment={removeAttachment}
              />
            </div>
          );
        }
        const layoutProps = {
          chat: chatNode,
          brief: (
            <JdsIntakeBriefPanel
              brief={active.brief}
              frozen={active.status === "promoted"}
              saving={savingBrief}
              onSaveBrief={active.status !== "promoted" ? saveBrief : undefined}
              onJumpToTurn={jumpToTurn}
              showTitle={false}
            />
          ),
          draft: <JdsIntakeDraftPane brief={active.brief} attachments={active.attachments ?? []} />,
          materials: (
            <JdsIntakeAttachmentsPane
              attachments={active.attachments ?? []}
              frozen={active.status === "promoted"}
              saving={savingAttachment}
              onAdd={addAttachment}
              onRemove={removeAttachment}
              showTitle={false}
            />
          ),
          counts: {
            turns: active.transcript.length,
            requirements: active.brief?.requirements?.length ?? 0,
            attachments: (active.attachments ?? []).length,
            draftReady: briefDraftHasContent(active.brief),
          },
        };
        return layoutVariant === "triptych" ? (
          <JdsIntakeLayoutTriptych {...layoutProps} />
        ) : (
          <JdsIntakeLayoutCockpit {...layoutProps} />
        );
      })()}
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
