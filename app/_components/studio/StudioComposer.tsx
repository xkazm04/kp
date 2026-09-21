"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { CircleDashed, Send } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { useStudioTranslations } from "./useStudioTranslations";

// THE COMPOSER AS ONE BARE FIELD ON THE PLANE.
//
// A hairline above it is the only boundary; there is no bordered input box, no
// captioned Send, no row of labelled voice buttons and no placeholder sentence
// telling the reader how to answer. Every action is a glyph that carries its
// own name (IconAction → aria-label + tooltip + sr-only), so the row costs one
// line of chrome instead of four.
//
// SENDING IS A GLYPH SWAP, not a spinner: the paper plane becomes a static
// dashed mark while a turn is in flight (animation austerity forbids
// `repeat: Infinity`), and the honest wait is drawn once, in the transcript.
//
// The guarantees: Enter sends, Shift+Enter newlines, the draft clears
// optimistically and is HANDED BACK when `onSend` resolves false, and anything
// a slot dictates APPENDS to whatever is typed and never sends on its own.
//
// THE DRAFT SURVIVES THE DIALOG. `draftKey` names a sessionStorage slot for the
// unsent text, so closing the overlay mid-sentence (or a refused send followed
// by a navigation) hands the words back on the next mount. Per-tab, per-session
// by construction — sessionStorage is exactly that scope.
//
// WHAT THE KIT DOES NOT KNOW: which voice plane, which side controls. Those
// arrive as slots. `leading` and `voiceSlot` sit in the left cluster (a
// materials glyph, the dictation pair), `actions` sits right before Send (a
// full-call relay). A slot that needs to write into the draft — dictation does —
// reaches it through `useStudioComposerDraft()`, a context this component
// provides, so the kit never hardcodes who is allowed to type.
//
// Strings: `<ns>.glyph.compose`, `<ns>.glyph.send`, `<ns>.thinking`.

export type StudioComposerDraftApi = {
  /** Append text to the draft — one space between, never replacing, never sending. */
  append(text: string): void;
  /** Focus the field (after a dictation lands, after a declined card set). */
  focus(): void;
  /** The line UNDER the glyph row, for a slot's own status text (a refused
   *  dictation, a failed synthesis) — portal into it so a one-line refusal is
   *  never squeezed into the glyph cluster. Null until mounted. */
  footer: HTMLElement | null;
};

const DraftContext = createContext<StudioComposerDraftApi | null>(null);

/** For a component rendered INSIDE a StudioComposer slot: the draft it may type into. */
export function useStudioComposerDraft(): StudioComposerDraftApi {
  const api = useContext(DraftContext);
  if (!api) {
    throw new Error("useStudioComposerDraft: rendered outside a StudioComposer slot");
  }
  return api;
}

/** The same handle, or null when rendered outside a composer (a slot component
 *  that also stands alone falls back to drawing its notices inline). */
export function useStudioComposerSlot(): StudioComposerDraftApi | null {
  return useContext(DraftContext);
}

export type StudioComposerProps = {
  onSend(text: string): Promise<boolean> | boolean;
  disabled: boolean;
  sending: boolean;
  /** sessionStorage key for the unsent draft (hand-back on a refused send). */
  draftKey: string;
  ns: string;
  /** The dictation control slot (StudioVoiceBar) — a ReactNode so the kit never
   *  hardcodes which voice plane a consumer wires. */
  voiceSlot?: ReactNode;
  placeholder?: string;
  maxChars?: number;
  /** Glyphs before the voice slot in the left cluster (a materials paperclip). */
  leading?: ReactNode;
  /** Controls right before Send (a full-call relay button). */
  actions?: ReactNode;
  /** The consumer's handle on the field, for hand-back of focus from elsewhere. */
  focusRef?: RefObject<HTMLTextAreaElement | null>;
};

function readDraft(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    /* blocked storage: the draft starts empty, exactly as before there was a key */
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable — the draft still holds for this mount */
  }
}

export function StudioComposer({
  onSend,
  disabled,
  sending,
  draftKey,
  ns,
  voiceSlot,
  placeholder,
  maxChars,
  leading,
  actions,
  focusRef,
}: StudioComposerProps) {
  const t = useStudioTranslations(ns);
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = focusRef ?? ownRef;
  const off = disabled || sending;

  useEffect(() => {
    writeDraft(draftKey, draft);
  }, [draftKey, draft]);

  const focus = useCallback(() => inputRef.current?.focus(), [inputRef]);
  // Appends and never sends: a transcription is a first draft, and a mis-heard
  // word must be fixable before it becomes a turn.
  const append = useCallback(
    (text: string) => {
      const words = text.trim();
      if (!words) return;
      setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${words}` : words));
      inputRef.current?.focus();
    },
    [inputRef]
  );
  // State, not a ref: a slot portals into this node, and a ref would be null on
  // the slot's first render with nothing to trigger the second.
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const api = useMemo<StudioComposerDraftApi>(() => ({ append, focus, footer }), [append, focus, footer]);

  async function submit() {
    const message = draft.trim();
    if (!message || off) return;
    setDraft("");
    const ok = await onSend(message);
    if (ok === false) setDraft((d) => (d.trim() ? d : message));
  }

  return (
    <DraftContext.Provider value={api}>
      <div className="shrink-0 border-t border-stone-200 pt-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          aria-label={t("glyph.compose")}
          placeholder={placeholder}
          maxLength={maxChars}
          disabled={off}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="focus-ring w-full resize-none rounded-md bg-transparent px-0.5 py-1 text-body leading-7 text-ink outline-none disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-0.5">
            {leading}
            {voiceSlot}
          </span>
          <span className="flex items-center gap-2">
            {actions}
            <IconAction
              icon={sending ? CircleDashed : Send}
              label={t("glyph.send")}
              hint={sending ? t("thinking") : undefined}
              disabled={off || !draft.trim()}
              tone={sending ? "muted" : "default"}
              onClick={() => void submit()}
            />
          </span>
        </div>
        {/* A refusal the reader must act on is never chrome — slots put theirs here. */}
        <div ref={setFooter} />
      </div>
    </DraftContext.Provider>
  );
}
