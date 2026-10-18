"use client";

// The release card for a HELD first-contact outreach letter (comms scope C2b). Every
// outreach door drafts a letter; this is where a person reads the exact text the send will
// carry (footers included, links as placeholders), sees where it will actually go, approves
// that revision and releases it. Renders nothing for an application with no letter.
//
// Approval names the revision rendered here. A 409 is shown inline as "the letter changed,
// reload" and is never retried. Failures and refusals (stale, suppressed, delivery_failed)
// are states of this card, not toasts. Keyless, a release is "queued" and the card says so:
// it never implies a delivery.

import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { OfferLetterForecast } from "@/app/_lib/comms-letter-preview";
import {
  approveLetter,
  canApprove,
  canRelease,
  loadLetter,
  releaseLetter,
  type CardOutcome,
  type OutreachLetterView,
} from "./outreachCard";

function languageName(appLocale: string, letterLocale: string): string {
  try {
    return new Intl.DisplayNames([appLocale], { type: "language" }).of(letterLocale) ?? letterLocale;
  } catch {
    // best-effort: an engine without DisplayNames data still shows the code
    return letterLocale;
  }
}

export function OutreachReleaseCard({ entryId, refreshKey }: { entryId: string; refreshKey?: unknown }) {
  const t = useTranslations("pipeline.candidate.outreach");
  const appLocale = useLocale();
  const errorMessage = useErrorMessage();
  const [view, setView] = useState<OutreachLetterView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"approve" | "release" | null>(null);
  const [outcome, setOutcome] = useState<CardOutcome>({ kind: "none" });

  // Bumped to re-read the letter after an action or a Reload click.
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    // Re-read when the entry changes, an outreach task has just drafted a new revision,
    // or an action asked for it.
    let live = true;
    loadLetter(entryId)
      .then((next) => {
        if (!live) return;
        setView(next);
        setLoadFailed(false);
        setLoaded(true);
      })
      .catch(() => {
        // best-effort: the card says it could not load; the Reload button retries
        if (!live) return;
        setLoadFailed(true);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [entryId, refreshKey, tick]);

  if (!loaded && !view) return null;
  if (!view) {
    return loadFailed ? (
      <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-meta`}>
        {t("loadFailed")}{" "}
        <button type="button" onClick={reload} className={`${BTN_GHOST} h-8 cursor-pointer px-2 text-meta underline`}>
          {t("reload")}
        </button>
      </p>
    ) : null;
  }

  const { letter, preview } = view;
  const forecastLine = (forecast: OfferLetterForecast, reason: string | null): { text: string; tone: "ok" | "warn" | "stop" } => {
    switch (forecast) {
      case "relay":
        return reason === "no_contact" ? { text: t("forecastRelayNoContact"), tone: "warn" } : { text: t("forecastRelay"), tone: "ok" };
      case "local":
        return { text: t("forecastLocal"), tone: "warn" };
      case "simulation":
        return { text: t("forecastSimulation"), tone: "warn" };
      case "refused":
        return { text: t("forecastRefused"), tone: "stop" };
      case "suppressed":
        return { text: t("forecastSuppressed", { reason: reason ?? "other" }), tone: "stop" };
    }
  };
  const line = forecastLine(preview.forecast, preview.forecastReason);
  const settled = letter.state === "released" || letter.state === "discarded";

  const approve = async () => {
    setBusy("approve");
    setOutcome({ kind: "none" });
    // The revision this card RENDERED, not a fresh read: the person approves what they saw.
    const result = await approveLetter(letter.id, letter.revision);
    setBusy(null);
    if (result.kind === "none") reload();
    else setOutcome(result);
  };
  const release = async () => {
    setBusy("release");
    setOutcome({ kind: "none" });
    const result = await releaseLetter(letter.id);
    reload();
    setBusy(null);
    setOutcome(result);
  };

  // What the last action (or, once released, the letter's own state) says about delivery.
  const note = (() => {
    switch (outcome.kind) {
      case "stale":
        return { text: t("stale"), tone: "amber" as const, reload: true };
      case "suppressed":
        return { text: t("suppressedNote", { reason: outcome.reason ?? "other" }), tone: "critical" as const, reload: false };
      case "failed":
        return { text: t("failed"), tone: "critical" as const, reload: false };
      case "error":
        return { text: errorMessage(outcome.error, t("actionFailed")), tone: "critical" as const, reload: false };
      case "queued":
        return { text: t("queued"), tone: "amber" as const, reload: false };
      case "sent":
        return { text: t("sent"), tone: "ok" as const, reload: false };
      case "none":
        break;
    }
    if (letter.state === "delivery_failed") return { text: t("failed"), tone: "critical" as const, reload: false };
    if (letter.state === "suppressed") return { text: t("suppressedNote", { reason: "other" }), tone: "critical" as const, reload: false };
    if (letter.state === "released") {
      const recorded = preview.forecast === "local" || preview.forecast === "simulation";
      return { text: recorded ? t("releasedLocal") : t("releasedRelay"), tone: recorded ? ("amber" as const) : ("ok" as const), reload: false };
    }
    return null;
  })();

  return (
    <section aria-label={t("aria")} aria-busy={busy !== null} className={`${PANEL} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={14} className="shrink-0 text-coral-ink" aria-hidden />
        <h3 className={META_LABEL}>{t("title")}</h3>
        <span className={CHIP_QUIET}>{t(`state.${letter.state}`)}</span>
        {letter.approvedBy ? <span className="text-meta text-steel">{t("approvedBy", { approver: letter.approvedBy.replace(/^human:/, "") })}</span> : null}
      </div>

      {settled ? null : (
        <p
          role="status"
          className={line.tone === "ok" ? "text-meta text-moss" : `${NOTICE(line.tone === "stop" ? "critical" : "amber")} px-2 py-1.5 text-meta`}
        >
          {line.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-meta text-steel">
        <span className={CHIP_QUIET}>{t("letterLanguage", { language: languageName(appLocale, preview.locale) })}</span>
        <span>{preview.recipient ? t("letterTo", { recipient: preview.recipient }) : t("letterNoRecipient")}</span>
      </div>
      <div className="rounded-md border border-stone-200 bg-white p-2.5" lang={preview.locale}>
        <p className="text-meta font-semibold text-ink">{t("letterSubject", { subject: preview.subject })}</p>
        <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-meta text-ink">{preview.body}</p>
      </div>
      <p className="text-meta text-steel">{t("placeholderNote")}</p>

      {note ? (
        <p
          role={note.tone === "ok" ? "status" : "alert"}
          className={note.tone === "ok" ? "text-meta text-moss" : `${NOTICE(note.tone)} px-2 py-1.5 text-meta`}
        >
          {note.text}
          {note.reload ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => {
                  setOutcome({ kind: "none" });
                  reload();
                }}
                className={`${BTN_GHOST} h-8 cursor-pointer px-2 text-meta underline`}
              >
                {t("reload")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {letter.state === "released" || letter.state === "discarded" ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove(letter.state) ? (
            <button
              type="button"
              onClick={() => void approve()}
              disabled={busy !== null || outcome.kind === "stale"}
              aria-busy={busy === "approve"}
              className={`${BTN_SECONDARY} h-9 cursor-pointer px-4 text-meta disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy === "approve" ? t("approving") : t("approve")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void release()}
            disabled={!canRelease(letter.state) || busy !== null}
            aria-busy={busy === "release"}
            className={`${BTN_PRIMARY} h-9 cursor-pointer px-4 text-meta disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy === "release" ? t("releasing") : letter.state === "approved" || letter.state === "drafted" ? t("release") : t("releaseRetry")}
          </button>
        </div>
      )}
    </section>
  );
}
