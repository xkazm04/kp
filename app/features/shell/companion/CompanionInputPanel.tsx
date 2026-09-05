"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useStt } from "@/packages/voice-stt/src/react/useStt";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useOptionalCompanionDock } from "./CompanionDockProvider";

/*
 * Typing to Candi, as a LAYER-2 PANEL of the footer control dock.
 *
 * Round V2 hung this over the bottom edge as a free-floating pill above the
 * control bar. That was two floating chromes stacked at the same edge, one of
 * which was the app's actual footer, and it left "Ask Candi" as the one control
 * in the console that opened something the console did not own. V3 puts her in
 * the dock's single panel slot (`candi`), which buys three things at once: the
 * exclusivity rule covers her (opening Automations closes Candi, and the
 * reverse), the roving toolbar reaches her the same way it reaches every other
 * panel, and the input sits at the width the footer already establishes rather
 * than at a width it invented.
 *
 * IT READS THE CONTEXT RATHER THAN TAKING PROPS. The thread lives in
 * `CompanionDockProvider`, above both this panel and the voice strip, and this
 * panel is only ever offered when that provider exists — so plumbing `send`
 * down through four simulation components would be four files that know about
 * the companion in order to carry something they never look at.
 *
 * ONE LINE, deliberately. The dock's composer is a four-row textarea because a
 * conversation column is already spending the screen; here the deal is the
 * opposite — the operator gave up the column to keep the page visible, and the
 * panel opens INSIDE a footer that has other things to be. Hence an `<input>`:
 * a single line cannot grow, Enter has exactly one meaning, and there is no
 * Shift+Enter to explain.
 *
 * The draft contract is `ChatComposer`'s, deliberately reproduced rather than
 * shared: cleared optimistically on send, RESTORED when the exchange resolves
 * false, and never clobbering what was typed while the request was in flight. A
 * refused message (429, offline, a thread that moved) otherwise leaves the
 * sentence existing nowhere.
 *
 * SENDING KEEPS THE PANEL OPEN. It is a conversation: her answer lands in the
 * strip at the top of the screen and the next question is typed here, so a panel
 * that closed itself on send would make every second message a two-click act.
 *
 * THE MIC RECORDS. It was a disabled placeholder for as long as there was
 * nothing behind it; there is now — `/api/stt` with an on-device-first engine
 * order, and `@kazm/voice-stt/react` carrying the permission dance, the capture,
 * the encode to what whisper.cpp reads, and the abort. This panel owns only the
 * three things that are ITS: where the transcript lands, what the operator sees
 * while it is working, and how a refusal is said.
 *
 * IT DICTATES INTO THE COMPOSER, it does not send. The transcript is appended to
 * whatever is already typed and the caret stays in the field, so a mis-heard word
 * is fixed before Candi ever sees it. A mic that sent on release would make every
 * transcription error a message in the thread.
 *
 * ONE CONTROL, TWO MEANINGS (start / stop), mirroring CompanionSpeakButton on the
 * output side: `aria-pressed` while recording, a stop glyph rather than a second
 * button, and the busy phases (encoding, uploading) refuse a press instead of
 * queuing a second capture.
 *
 * STT_UNAVAILABLE LATCHES, and nothing else does. A keyless install with no local
 * model answers 503 with that code, and the operator's fix is a server config
 * rather than another press — so the control goes quiet and names the reason,
 * rather than recording into the same refusal every time. The hook clears the
 * latch when a probe finds a ready engine. Every OTHER failure (a denied
 * microphone, a throttle, an engine fault) leaves the button live: an operator who
 * just granted permission is one press from it working. This is the "handle the
 * 503" half of the choice — no probe on mount, because a GET on every dock open
 * spends a readdir per model directory on a panel most operators only type into.
 */
export function CompanionInputPanel() {
  const t = useTranslations("companion");
  const locale = useLocale();
  const resolveError = useErrorMessage();
  const dock = useOptionalCompanionDock();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Appended, never replacing: the operator may have typed half a sentence
  // before pressing the mic, and a transcript that clobbered it would lose words
  // the app never had to lose.
  const acceptTranscript = useCallback((text: string) => {
    setDraft((current) => (current.trim() ? `${current.trim()} ${text}` : text));
    inputRef.current?.focus();
  }, []);
  const stt = useStt({ endpoint: "/api/stt", language: locale, onTranscript: acceptTranscript });

  // The panel mounts when the operator pressed Ask Candi. Focus follows the
  // press: they opened a place to type, so the caret belongs in it. A ref rather
  // than `autoFocus` because this is a panel that mounts and unmounts on a
  // toggle, not a page that loads once.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!dock) return null;
  const thread = dock.thread;
  // `ready` matters as much as `busy`: the panel can be opened before the thread
  // has booted, and a message sent into no thread resolves false and silently
  // restores itself, which reads as the app ignoring you.
  const busy = thread.busy || !thread.ready;
  // A disabled field with no reason is the half of the dead end the strip's
  // Reconnect does not fix: the input greys out identically whether she is
  // thinking about the last question or the thread never booted at all. It says
  // which, and where the way out is.
  const why = !thread.ready ? t("voiceMode.notReady") : null;
  const recording = stt.phase === "recording";
  // One line under the row, and only ever one thing in it: what the mic is doing,
  // or why it stopped. A code the server named is resolved in the reader's
  // language; a browser-side denial has no code, so the panel's own sentence
  // stands in rather than the browser's English `NotAllowedError`.
  const micNote = stt.unavailable
    ? t("voiceMode.micUnavailable")
    : stt.phase === "error"
      ? resolveError({ code: stt.errorCode }, t("voiceMode.micFailed"))
      : recording
        ? t("voiceMode.micRecording")
        : stt.busy
          ? t("voiceMode.micWorking")
          : null;
  const micLabel = recording ? t("voiceMode.micStop") : stt.unavailable ? t("voiceMode.micUnavailable") : t("voiceMode.mic");

  async function submit() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    const ok = await thread.send(message);
    if (!ok) setDraft((current) => (current.trim() ? current : message));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 py-1.5 pl-3 pr-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
          placeholder={t("voiceMode.placeholder")}
          aria-label={t("voiceMode.placeholder")}
          title={why ?? undefined}
          disabled={busy}
          // No FIELD recipe: that one carries the rounded-md bordered box, and the
          // row itself IS the box here. The field inside it must be invisible.
          className="min-w-0 flex-1 bg-transparent text-base text-ink caret-coral outline-none placeholder:text-steel disabled:opacity-60"
        />
        <button
          type="button"
          onClick={stt.toggle}
          disabled={stt.busy || stt.unavailable}
          aria-pressed={recording}
          aria-label={micLabel}
          title={micLabel}
          className={`focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
            recording ? "bg-coral/10 text-coral" : "text-steel hover:text-ink"
          }`}
        >
          {recording ? <Square size={15} aria-hidden /> : <Mic size={17} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !draft.trim()}
          aria-label={t("chat.send")}
          title={t("chat.send")}
          className={`${BTN_PRIMARY} h-9 w-9 shrink-0 justify-center rounded-full p-0 dark:rounded-full`}
        >
          <ArrowUp size={17} aria-hidden />
        </button>
      </div>
      {micNote ? (
        <p className="px-1 text-sm text-steel" role="status">
          {micNote}
        </p>
      ) : null}
    </div>
  );
}
