"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import {
  StudioComposer,
  StudioDesk,
  StudioOverlay,
  StudioTranscript,
  StudioVoiceBar,
  useStudioComposerDraft,
  useStudioOverlayClose,
} from "@/app/_components/studio";
import { CHIP_QUIET, EYEBROW, NOTICE } from "@/app/_components/ui/recipes";
import { Fade } from "@/app/features/hiring/pipeline/PipelineMotion";
import { companionFallbackClass } from "@/app/_lib/companion-turn";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CvPolishArtifact, DialogReply, JobseekerDialog, JobseekerProfile, StudioTurn } from "@/app/_lib/jobseeker/types";
import { CvSheet } from "./CvSheet";

// THE CV STUDIO — the Studio kit's first seeker variant (docs/features/jobseeker/README.md).
//
// The kit owns the surface (overlay, desk, zones, transcript blocks, bare composer,
// voice pair, decision cards); this file is COMPOSITION, exactly as the intake desk
// is: two zones (conversation · sheet), the plane is `CvSheet`, the namespace is
// `me`, the storage keys are the seeker's own, and `send` posts to the dialog's
// message route. The variant is PROPS, never a coat.
//
// A CLOSED dialog reopens read-only: no composer, cards as a record, the sheet as it
// was left. The transcript is the record of what was suggested and why.

const NS = "me";
const ZONES = ["chat", "sheet"] as const;
type Zone = (typeof ZONES)[number];
const COLUMNS_KEY = "kp-me-cv-cols";
const AUTO_SPEAK_KEY = "kp-me-auto-speak";

export type StudioDegradation = { reason: string | null; lang: string | null };

type SendError = { code: string | null };

export function CvStudio({
  dialog,
  profile,
  initialDegradation,
  onDialogChange,
  onProfileChange,
  onClose,
}: {
  dialog: JobseekerDialog;
  profile: JobseekerProfile;
  initialDegradation: StudioDegradation | null;
  onDialogChange(dialog: JobseekerDialog): void;
  onProfileChange(profile: JobseekerProfile): void;
  onClose(): void;
}) {
  const t = useTranslations("me.cv");
  const tCols = useTranslations("me.columns");
  const locale = useLocale();
  const resolveError = useErrorMessage();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [degradation, setDegradation] = useState<StudioDegradation | null>(initialDegradation);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const closed = dialog.status !== "open";
  const artifact = dialog.artifact && "cvMarkdown" in dialog.artifact ? (dialog.artifact as CvPolishArtifact) : null;

  const reload = useCallback(async () => {
    const res = await fetch(`/api/jobseeker/dialogs/${dialog.id}`);
    const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog } | null;
    if (res.ok && body?.dialog) onDialogChange(body.dialog);
  }, [dialog.id, onDialogChange]);

  // One exchange. Resolves `false` when nothing landed — the composer hands the
  // draft back and a card set keeps its selection (the kit's contract).
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (sending || closed) return false;
      setSending(true);
      setError(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/jobseeker/dialogs/${dialog.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
          signal: ctrl.signal,
        });
        const body = (await res.json().catch(() => null)) as (DialogReply & { code?: string }) | null;
        if (!res.ok || !body) {
          // The row moved or closed under us: re-read rather than paint a stale copy.
          if (body?.code === "JOBSEEKER_DIALOG_MOVED" || body?.code === "JOBSEEKER_DIALOG_CLOSED") await reload();
          setError({ code: body?.code ?? null });
          return false;
        }
        const now = new Date().toISOString();
        const turns: StudioTurn[] = [
          { role: "candidate", text, at: now },
          { role: "interviewer", text: body.reply, at: now, ...(body.choices ? { choices: body.choices } : {}) },
        ];
        onDialogChange({
          ...dialog,
          transcript: [...dialog.transcript, ...turns],
          artifact: body.artifact ?? dialog.artifact,
          status: body.done ? "closed" : "open",
        });
        setDegradation(body.source === "deterministic" ? { reason: body.fallbackReason ?? null, lang: body.fallbackLang ?? null } : null);
        if (body.done) {
          // The close merged preferences and stored the polished CV: the page
          // re-reads its profile so the chips and the download door reflect it.
          const p = await fetch("/api/jobseeker/profile");
          if (p.ok) onProfileChange((await p.json()) as JobseekerProfile);
        }
        return true;
      } catch {
        if (ctrl.signal.aborted) return false;
        setError({ code: null });
        return false;
      } finally {
        abortRef.current = null;
        setSending(false);
      }
    },
    [sending, closed, dialog, onDialogChange, onProfileChange, reload]
  );

  // The agent's newest line, for read-aloud — null while a turn is in flight.
  const speakText = useMemo(() => {
    if (sending) return null;
    for (let i = dialog.transcript.length - 1; i >= 0; i -= 1) {
      const turn = dialog.transcript[i];
      if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
    }
    return null;
  }, [dialog.transcript, sending]);

  const fallbackClass = degradation ? companionFallbackClass(degradation.reason) : null;
  const degradedText =
    fallbackClass === "noProvider" ? t("degradedNoProvider") : fallbackClass === "providerFailed" ? t("degradedProviderFailed") : t("degradedNote");
  const standIn =
    degradation?.lang && degradation.lang !== locale
      ? t("standInLanguage", { language: new Intl.DisplayNames([locale], { type: "language" }).of(degradation.lang) ?? degradation.lang })
      : null;
  // The three chrome lines a studio can owe its reader, on the shared NOTICE recipe
  // and the shared `Fade` presence shape (PipelineMotion) instead of hand-painted
  // colour strings. Two of them are honesty notices about what produced what is being
  // read and must stay visible (surface-doctrine.md 1); the third is a failure the
  // reader has to act on, so it is `critical` with role="alert", never text-red-700.
  const sendErrorText = error ? resolveError(error, t("sendError")) : "";

  const heading = profile.profile.displayName?.trim() || t("untitled");
  const suggestionCount = artifact?.suggestions.length ?? 0;
  const meta = {
    chat: { count: String(dialog.transcript.length), countHint: tCols("badge.turns", { count: dialog.transcript.length }) },
    sheet: { count: String(suggestionCount), countHint: tCols("badge.suggestions", { count: suggestionCount }) },
  };

  return (
    <StudioOverlay
      open
      ns={NS}
      titleId="cv.dialogLabel"
      titleValues={{ name: heading }}
      sending={sending}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      header={
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-stone-200 px-5 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className={EYEBROW}>{t("eyebrow")}</span>
            <span className="min-w-0 truncate font-serif text-h3 text-ink">{heading}</span>
            <span className={CHIP_QUIET}>{t(`status.${dialog.status}`)}</span>
          </div>
          <CloseControl />
        </header>
      }
    >
      <div className="shrink-0 px-5">
        <Fade show={Boolean(degradation)} className="mt-2">
          <p className={`${NOTICE("amber")} px-3 py-1.5 text-meta`} role="status">
            {degradedText}
          </p>
        </Fade>
        <Fade show={Boolean(standIn)} className="mt-2">
          <p className={`${NOTICE("info")} px-3 py-1.5 text-meta`} role="status">
            {standIn}
          </p>
        </Fade>
        <Fade show={Boolean(error)} className="mt-2">
          <p className={`${NOTICE("critical")} px-3 py-1.5 text-sm`} role="alert">
            {sendErrorText}
          </p>
        </Fade>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-5">
        <StudioDesk<Zone>
          ns={NS}
          zones={{ keys: ZONES, storageKey: COLUMNS_KEY, pinned: ["chat"] }}
          transcriptZone="chat"
          planeZone="sheet"
          sending={sending}
          meta={meta}
          transcript={
            <StudioTranscript
              ns={NS}
              turns={dialog.transcript}
              latestIndex={dialog.transcript.length > 0 ? dialog.transcript.length - 1 : null}
              sending={sending}
              closed={closed}
              onPick={send}
              onDecline={() => composerRef.current?.focus()}
            />
          }
          composer={
            !closed ? (
              <StudioComposer
                ns={NS}
                onSend={send}
                disabled={sending || closed}
                sending={sending}
                draftKey={`kp-me-cv-draft:${dialog.id}`}
                focusRef={composerRef}
                voiceSlot={<SeekerDictationSlot lang={dialog.lang} sessionKey={dialog.id} speakText={speakText} disabled={sending} />}
              />
            ) : null
          }
          plane={
            <CvSheet
              artifact={artifact}
              fallbackMarkdown={profile.cvPolishedMd}
              closed={closed}
              sending={sending}
              onApply={(section) => void send(t("applyMessage", { section }))}
            />
          }
        />
      </div>
    </StudioOverlay>
  );
}

/** The header's close glyph — the kit's GATED close, so a click here asks the same
 *  "a reply is still arriving" question Escape does. */
function CloseControl() {
  const tCommon = useTranslations("common");
  const requestClose = useStudioOverlayClose();
  return (
    <button
      type="button"
      onClick={requestClose}
      aria-label={tCommon("close")}
      className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100 hover:text-ink"
    >
      <X size={18} aria-hidden />
    </button>
  );
}

/** The seeker's dictation pair, wired into the kit composer's draft: dictated words
 *  APPEND through the composer's own handle and never send. */
function SeekerDictationSlot({
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
      autoSpeakStorageKey={AUTO_SPEAK_KEY}
      onDictation={draft.append}
    />
  );
}
