"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { StudioComposer, StudioDesk, StudioOverlay, StudioTranscript, StudioVoiceBar, useStudioComposerDraft, useStudioOverlayClose } from "@/app/_components/studio";
import { CHIP_QUIET, EYEBROW } from "@/app/_components/ui/recipes";
import { companionFallbackClass } from "@/app/_lib/companion-turn";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { DialogReply, FitArtifact, JobseekerDialog, StudioTurn } from "@/app/_lib/jobseeker/types";
import type { StudioDegradation } from "./CvStudio";
import { FitSheet } from "./FitSheet";
import type { PostingDetailView } from "./postingView";

// THE FIT STUDIO (UC3) — the Studio kit's SECOND seeker variant, and CvStudio's twin
// in composition: two zones (conversation · fit sheet), the plane is `FitSheet`, the
// namespace is `me`, the storage keys are its own (`kp-me-fit-cols`, the shared
// `kp-me-auto-speak` opt-in), and `send` posts to the same message route. The variant
// is PROPS, never a coat.
//
// The coach reads the posting, the match and the seeker's last dismissals (the
// message route passes them; see app/api/jobseeker/dialogs/[id]/message/route.ts) and
// helps decide. `done` lands when the seeker picks a verdict; a verdict of `apply`
// offers "Mark applied" on the sheet.

const NS = "me";
const ZONES = ["chat", "fit"] as const;
type Zone = (typeof ZONES)[number];
const COLUMNS_KEY = "kp-me-fit-cols";
const AUTO_SPEAK_KEY = "kp-me-auto-speak";

type SendError = { code: string | null };

export function FitStudio({
  dialog,
  posting,
  initialDegradation,
  applied,
  onDialogChange,
  onDone,
  onMarkApplied,
  onClose,
}: {
  dialog: JobseekerDialog;
  posting: PostingDetailView;
  initialDegradation: StudioDegradation | null;
  applied: boolean;
  onDialogChange(dialog: JobseekerDialog): void;
  /** The conversation settled: the verdict leaves the overlay and lands on the posting
   *  page, CvStudio's `done` twin (which re-reads the profile). */
  onDone(artifact: FitArtifact): void;
  onMarkApplied(): void;
  onClose(): void;
}) {
  const t = useTranslations("me.fit");
  const tCv = useTranslations("me.cv");
  const tCols = useTranslations("me.columns");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const resolveError = useErrorMessage();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [degradation, setDegradation] = useState<StudioDegradation | null>(initialDegradation);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const closed = dialog.status !== "open";
  const artifact = dialog.artifact && "verdict" in dialog.artifact ? (dialog.artifact as FitArtifact) : null;

  const reload = useCallback(async () => {
    const res = await fetch(`/api/jobseeker/dialogs/${dialog.id}`);
    const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog } | null;
    if (res.ok && body?.dialog) onDialogChange(body.dialog);
  }, [dialog.id, onDialogChange]);

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
          if (body?.code === "JOBSEEKER_DIALOG_MOVED" || body?.code === "JOBSEEKER_DIALOG_CLOSED") await reload();
          setError({ code: body?.code ?? null });
          return false;
        }
        const now = new Date().toISOString();
        const turns: StudioTurn[] = [
          { role: "candidate", text, at: now },
          { role: "interviewer", text: body.reply, at: now, ...(body.choices ? { choices: body.choices } : {}) },
        ];
        const settled = body.artifact ?? dialog.artifact;
        onDialogChange({ ...dialog, transcript: [...dialog.transcript, ...turns], artifact: settled, status: body.done ? "closed" : "open" });
        setDegradation(body.source === "deterministic" ? { reason: body.fallbackReason ?? null, lang: body.fallbackLang ?? null } : null);
        // The close is the only moment this verdict becomes the posting's: the detail
        // page behind the overlay reads a CLOSED dialog, and it is not re-fetching.
        if (body.done && settled && "verdict" in settled) onDone(settled as FitArtifact);
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
    [sending, closed, dialog, onDialogChange, onDone, reload]
  );

  const speakText = useMemo(() => {
    if (sending) return null;
    for (let i = dialog.transcript.length - 1; i >= 0; i -= 1) {
      const turn = dialog.transcript[i];
      if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
    }
    return null;
  }, [dialog.transcript, sending]);

  const fallbackClass = degradation ? companionFallbackClass(degradation.reason) : null;
  const degradedText = fallbackClass === "noProvider" ? t("degradedNoProvider") : fallbackClass === "providerFailed" ? tCv("degradedProviderFailed") : tCv("degradedNote");
  const standIn =
    degradation?.lang && degradation.lang !== locale
      ? tCv("standInLanguage", { language: new Intl.DisplayNames([locale], { type: "language" }).of(degradation.lang) ?? degradation.lang })
      : null;
  const notices = [
    degradation ? { key: "degraded", cls: "text-meta text-steel", text: degradedText } : null,
    standIn ? { key: "standIn", cls: "text-meta text-steel", text: standIn } : null,
    error ? { key: "send", cls: "text-body text-red-700", text: resolveError(error, tCv("sendError")) } : null,
  ].filter((n): n is { key: string; cls: string; text: string } => n !== null);

  const gapCount = artifact?.gaps.length ?? 0;
  const meta = {
    chat: { count: String(dialog.transcript.length), countHint: tCols("badge.turns", { count: dialog.transcript.length }) },
    fit: { count: String(gapCount), countHint: tCols("badge.gaps", { count: gapCount }) },
  };

  return (
    <StudioOverlay
      open
      ns={NS}
      titleId="fit.dialogLabel"
      titleValues={{ title: posting.title }}
      sending={sending}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      header={
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-stone-200 px-5 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className={EYEBROW}>{t("eyebrow")}</span>
            <span className="min-w-0 truncate font-serif text-h3 text-ink">{posting.title}</span>
            <span className={CHIP_QUIET}>{tCv(`status.${dialog.status}`)}</span>
          </div>
          <CloseControl />
        </header>
      }
    >
      <div className="shrink-0 px-5">
        <AnimatePresence initial={false}>
          {notices.map((n) => (
            <motion.p key={n.key} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }} className={`mt-2 ${n.cls}`}>
              {n.text}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-5">
        <StudioDesk<Zone>
          ns={NS}
          zones={{ keys: ZONES, storageKey: COLUMNS_KEY, pinned: ["chat"] }}
          transcriptZone="chat"
          planeZone="fit"
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
                draftKey={`kp-me-fit-draft:${dialog.id}`}
                focusRef={composerRef}
                voiceSlot={<SeekerDictationSlot lang={dialog.lang} sessionKey={dialog.id} speakText={speakText} disabled={sending} />}
              />
            ) : null
          }
          plane={<FitSheet posting={posting} artifact={artifact} closed={closed} applied={applied} onMarkApplied={onMarkApplied} />}
        />
      </div>
    </StudioOverlay>
  );
}

function CloseControl() {
  const tCommon = useTranslations("common");
  const requestClose = useStudioOverlayClose();
  return (
    <button type="button" onClick={requestClose} aria-label={tCommon("close")} className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100 hover:text-ink">
      <X size={18} aria-hidden />
    </button>
  );
}

function SeekerDictationSlot({ lang, sessionKey, speakText, disabled }: { lang: string; sessionKey: string; speakText: string | null; disabled: boolean }) {
  const draft = useStudioComposerDraft();
  return <StudioVoiceBar ns={NS} lang={lang} sessionKey={sessionKey} speakText={speakText} disabled={disabled} autoSpeakStorageKey={AUTO_SPEAK_KEY} onDictation={draft.append} />;
}
