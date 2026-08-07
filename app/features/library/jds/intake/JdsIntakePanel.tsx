"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { briefReadyToPromote } from "@/app/_lib/intake-brief";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, INTRO, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { JdsIntakeBriefPanel } from "./JdsIntakeBriefPanel";
import { JdsIntakeChat } from "./JdsIntakeChat";
import { JdsIntakeVoice } from "./JdsIntakeVoice";
import { useIntakeLogic } from "./jdsIntakeLogic";

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
  } = useIntakeLogic(onPromoted);
  // Work-sample case design at promote — explicit opt-in (JD-builder checklist semantics).
  const [withCase, setWithCase] = useState(false);

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
      {degraded ? <p className="mt-2 text-meta text-steel">{t("degradedNote")}</p> : null}
      {voiceNote === "stored" ? <p className="mt-2 text-meta text-steel">{t("voice.storedNote")}</p> : null}
      {error === "send" ? <p className="mt-2 text-body text-red-700">{t("sendError")}</p> : null}
      {error === "promote" ? <p className="mt-2 text-body text-red-700">{t("promoteError")}</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <JdsIntakeChat
          transcript={active.transcript}
          sending={sending}
          closed={closed}
          onSend={send}
          voiceSlot={!closed ? <JdsIntakeVoice intakeId={active.id} disabled={sending} onCompleted={applyVoiceResult} /> : null}
        />
        <JdsIntakeBriefPanel brief={active.brief} />
      </div>
    </div>
  );
}
