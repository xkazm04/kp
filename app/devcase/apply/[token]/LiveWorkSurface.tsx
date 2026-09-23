"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { ProcessEvent, SeedFile } from "@/app/features/tools/devcases/DevTypes";
import { draftStorageKey, encodeDraft, decodeDraft, type LiveWorkDraft, type LiveWorkChatMessage } from "./liveWorkDraft";
import { createLiveWorkSync, DECISIONS_FILE, type LiveWorkSyncState } from "./liveWorkSync";
import { BTN_PRIMARY, BTN_SECONDARY, NOTICE, PANEL, PANEL_SUNKEN, toggleBtn } from "@/app/_components/ui/recipes";
import { useTablist } from "@/app/_components/ui/useTablist";

/** The captured chat channels, in strip order — literal array, derived union. */
const CHAT_CHANNELS = ["assistant", "stakeholder"] as const;
type ChatChannel = (typeof CHAT_CHANNELS)[number];

// Live Work Surface (moonshot E) — an in-product editor over the materialized seed.
// As the candidate works, it records OBSERVED process events (which files they
// open, edit, and decision-log entries) and flushes them + the file tree to the
// session. The engine then grades the judgment we WATCHED, not a reconstructed git
// log. We observe process artifacts only — never keystrokes or the screen.
//
// The session protocol itself (lazy mint, flush, re-buffer, refusal backoff, the
// seal-only-after-a-landed-flush submit) lives in liveWorkSync.ts, a framework-free
// client this component holds one of and renders from. What stays here is the page:
// the local draft (localStorage), the chat channel, the identity fields and the timers.

const FLUSH_MS = 8000;
const EDIT_DEBOUNCE_MS = 600;

/** Compact elapsed label, e.g. "1h 12m" or "45m". The unit strings come from the
 *  catalog, so the reader sees their own language rather than an English "h". */
function useDurationLabel() {
  const t = useTranslations("devApply.workSurface");
  return (minutes: number) => {
    const m = Math.max(0, Math.round(minutes));
    const h = Math.floor(m / 60);
    return h > 0 ? t("clockHm", { h, m: m % 60 }) : t("clockM", { m });
  };
}

/** The durable local copy (verifier pass 2026-07-17): the server flush is the system of
 *  record, but it lands every FLUSH_MS and can fail for minutes, so the tree, the pending
 *  events, the captured chat and the identity are mirrored to localStorage, scoped per
 *  apply-token so a shared device never bleeds one candidate's draft into another's. */
function writeDraft(
  token: string,
  sync: Pick<LiveWorkSyncState, "sessionId" | "sessionKey" | "files" | "pending">,
  extra: { chat: LiveWorkChatMessage[]; name: string; contact: string }
) {
  if (typeof window === "undefined") return;
  try {
    const draft: LiveWorkDraft = {
      sessionId: sync.sessionId,
      // The per-attempt key rides WITH its id, so a reload on this device still proves it.
      sessionKey: sync.sessionKey,
      files: sync.files,
      pending: sync.pending,
      chat: extra.chat,
      name: extra.name,
      contact: extra.contact,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(draftStorageKey(token), encodeDraft(draft));
  } catch {
    // localStorage can throw (quota, private-browsing lockout) — best-effort
    // backstop, not the only copy; the in-memory buffer + server flush remain.
  }
}

export function LiveWorkSurface({
  token,
  seedFiles,
  note,
  timeboxHours,
}: {
  token: string;
  seedFiles: SeedFile[];
  note: string | null;
  /** The case timebox the candidate was shown on the brief, already clamped by the
   *  page through devcase-timebox.ts. This component never carries a number of its own. */
  timeboxHours: number;
}) {
  const t = useTranslations("devApply.workSurface");
  const [activePath, setActivePath] = useState<string>(seedFiles[0]?.path ?? "");

  // Identity (UAT M9): the live-work surface is the SOLE submit path for workspace
  // cases now, so it collects who to reach — a winning evaluation with no address
  // is an unreachable candidate. Labels reuse the repo-form's `devApply` keys.
  const tApply = useTranslations("devApply");
  // The candidate's own language, sent with the finalize call so the acknowledgement
  // the shared intake produces is written in it rather than in the server's default.
  const locale = useLocale();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const nameRef = useRef("");
  const contactRef = useRef("");
  // Captured chat (LLM-era control #2): persisted in the local draft so a reload
  // does not wipe the prompt-channel evidence the candidate can see. Channel/input
  // chrome stays in-memory; only the transcript is durable here.
  const [chatMessages, setChatMessages] = useState<LiveWorkChatMessage[]>([]);
  const chatMessagesRef = useRef<LiveWorkChatMessage[]>([]);

  // One sync client per mount. Its draft writer is bound after mount (below), so the
  // client never closes over a ref during render.
  const [sync] = useState(() =>
    createLiveWorkSync({
      token,
      seedFiles,
      fetch: (url, init) => window.fetch(url, init),
      now: () => Date.now(),
      persist: () => {
        /* bound in the effect below, before any interaction can record */
      },
      clearDraft: () => {
        try {
          window.localStorage.removeItem(draftStorageKey(token));
        } catch {
          // best-effort cleanup only
        }
      },
    })
  );
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);
  // `refusal` is WHY the server refused (mint or submit), in the candidate's language via
  // useErrorMessage; `syncBlocked` is a 403 on this session id (never silent: the
  // candidate is told their work is held on this device and how to reconnect); a 410 on
  // submit is TERMINAL (`errorKind: "closed"`); `submissionRef` is the OPAQUE handle the
  // server derives from the submission id, so the internal id stays off the page.
  const { files, status, errorKind, perturbation, elapsedMinutes, syncBlocked } = snap;
  const refusal: ApiErrorPayload | null = snap.refusal;
  const submissionRef = snap.reference;

  const contactValid = /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit = name.trim().length > 0 && contactValid && status !== "submitting";
  const timeboxMinutes = Math.round(timeboxHours * 60);
  const duration = useDurationLabel();

  const [restored, setRestored] = useState(false);
  const errMsg = useErrorMessage();
  const persistDraft = useCallback(() => {
    writeDraft(token, sync.getSnapshot(), {
      chat: chatMessagesRef.current,
      name: nameRef.current,
      contact: contactRef.current,
    });
  }, [sync, token]);
  useEffect(() => sync.setPersist(persistDraft), [sync, persistDraft]);

  // Resume-on-mount: runs once, client-only (no localStorage during SSR; reading it
  // during render would desync markup). A brief seed -> restored flash is accepted —
  // silent, permanent loss is the worse failure mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = decodeDraft(window.localStorage.getItem(draftStorageKey(token)));
    if (!draft) return;
    sync.hydrate({ sessionId: draft.sessionId, sessionKey: draft.sessionKey, files: draft.files, pending: draft.pending });
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage (SSR-safe), the kp ConversationalApply convention */
    if (draft.chat.length > 0) {
      chatMessagesRef.current = draft.chat;
      setChatMessages(draft.chat);
    }
    if (draft.name) {
      nameRef.current = draft.name;
      setName(draft.name);
    }
    if (draft.contact) {
      contactRef.current = draft.contact;
      setContact(draft.contact);
    }
    if (draft.files.length > 0 || draft.pending.length > 0 || draft.chat.length > 0 || draft.name || draft.contact) {
      setRestored(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  }, []);

  useEffect(() => {
    // Keep the refs current for the sync client's persist hook. Synced in an effect
    // (not during render) per react-hooks/refs.
    nameRef.current = name;
    contactRef.current = contact;
    persistDraft();
  }, [name, contact, persistDraft]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
    persistDraft();
  }, [chatMessages, persistDraft]);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const record = useCallback(
    (kind: ProcessEvent["kind"], path?: string, size?: number) => sync.record(kind, path, size),
    [sync]
  );

  // Tick the clock between flushes so it reads as a clock, not a value that jumps
  // every eight seconds. The server's number overwrites it on the next flush, so drift
  // never accumulates and a paused tab re-syncs rather than under-counting.
  useEffect(() => {
    const iv = setInterval(() => sync.tickClock(), 60_000);
    return () => clearInterval(iv);
  }, [sync]);

  useEffect(() => {
    const iv = setInterval(() => void sync.flush(), FLUSH_MS);
    return () => {
      clearInterval(iv);
      if (editTimer.current) clearTimeout(editTimer.current);
    };
  }, [sync]);

  function selectFile(path: string) {
    if (path === activePath) return;
    setActivePath(path);
    record("open", path);
  }

  function onEdit(path: string, contents: string) {
    sync.edit(path, contents);
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      record(path.endsWith(DECISIONS_FILE) ? "decision_log" : "edit", path);
    }, EDIT_DEBOUNCE_MS);
  }

  function submit() {
    // The client carries the synchronous in-flight guard (a fast double click is a
    // no-op until the first settles) and refuses to seal after an unlanded flush.
    if (!canSubmit) return;
    void sync.submit({ candidate: name.trim(), contact: contact.trim(), locale, activePath });
  }

  const active = files.find((f) => f.path === activePath) ?? files[0];

  // Captured chat channels (LLM-era controls #2/#5): assistant + stakeholder.
  // Everything flows through the platform — the dialogue is part of the submission.
  const [chatChannel, setChatChannel] = useState<ChatChannel>("assistant");
  const chatTabs = useTablist({ ids: CHAT_CHANNELS, active: chatChannel, onSelect: setChatChannel, controlsPanel: false });
  // `deterministic` marks a reply produced by the keyless fallback rather than a model.
  // Degrading without keys is a product property here; letting the candidate believe a
  // stub was their stakeholder is not, so the bubble says so.
  const [chatInput, setChatInput] = useState("");
  // "limited" is a distinct terminal state from "error": the budget is a stated
  // product limit, not a fault, and it must never read as "your work was lost".
  const [chatState, setChatState] = useState<"idle" | "sending" | "error" | "limited">("idle");
  // WHY the chat door refused, in the reader's language. The route used to answer bare
  // English (and its catch forwarded the store's own message), so this surface had
  // nothing to resolve and painted one generic line over four different causes.
  const [chatRefusal, setChatRefusal] = useState<ApiErrorPayload | null>(null);

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatState === "sending") return;
    setChatState("sending");
    setChatRefusal(null);
    setChatMessages((prev) => [...prev, { channel: chatChannel, role: "user", text: message }]);
    setChatInput("");
    try {
      // The sync client mints if needed (a chat message is the candidate's own click, so it
      // may cross a mint-refusal backoff once) and proves the attempt with its session key.
      const r = await sync.chat({
        channel: chatChannel,
        message,
        currentFile: chatChannel === "assistant" && active ? { path: active.path, contents: active.contents } : null,
      });
      if (!r) throw new Error("no session");
      // 429 = the chat budget for this session or this link is spent. Tell the
      // candidate exactly that (and that their work is untouched) rather than the
      // generic "couldn't send", which reads like a fault they should fight.
      if (r.status === 429) {
        // The limiter runs before the message is stored, so nothing was recorded:
        // drop the optimistic bubble and hand the text back to the input.
        setChatMessages((prev) => prev.slice(0, -1));
        setChatInput(message);
        setChatState("limited");
        return;
      }
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as ApiErrorPayload | null;
        setChatRefusal(payload?.code ? payload : null);
        throw new Error("chat failed");
      }
      const data = (await r.json()) as { reply?: string; source?: string };
      if (data.reply)
        setChatMessages((prev) => [
          ...prev,
          { channel: chatChannel, role: "model", text: data.reply!, deterministic: data.source !== "llm" },
        ]);
      setChatState("idle");
    } catch {
      setChatState("error");
    }
  }

  const visibleChat = chatMessages.filter((m) => m.channel === chatChannel);

  if (status === "submitted") {
    // moss is the brand's affirmative — the same paint the repo-link form's
    // "received" panel uses — instead of a raw green ramp with no structural dark half.
    return (
      <section className="mt-6 rounded-lg border border-moss/40 bg-moss/5 p-5">
        <h2 className="font-serif text-h3 text-moss">{t("submittedTitle")}</h2>
        <p className="mt-1 text-body text-ink">{t("submitted")}</p>
        {/* Not a two-line cul-de-sac: say where the reply lands and leave a
            durable reference — the candidate just spent an hour in here. */}
        {contact.trim() ? <p className="mt-2 text-body text-ink">{t("submittedNext", { contact: contact.trim() })}</p> : null}
        {submissionRef ? <p className="mt-2 font-mono text-micro text-steel">{t("submittedRef", { ref: submissionRef })}</p> : null}
      </section>
    );
  }

  return (
    <section className={`mt-6 ${PANEL} p-5`}>
      <h2 className="font-serif text-h3 text-ink">{t("heading")}</h2>
      <p className="mt-1 max-w-prose text-sm text-steel">{t("intro")}</p>
      {/* Phone advisory (sm:hidden): a timed case started on a phone is a trap —
          say so BEFORE the candidate burns their attempt, without blocking them. */}
      <p className={`mt-2 ${NOTICE()} px-3 py-2 text-sm sm:hidden`}>
        {t("phoneAdvisory")}
      </p>
      {note ? <p className="mt-2 text-micro text-steel">{note}</p> : null}
      {/* "We restored your draft" is neutral context worth reading — not a caveat
          and not a failure — so it takes the info tone through the shared notice. */}
      {restored ? (
        <p className={`mt-2 ${NOTICE("info")} px-3 py-1.5 text-micro`} role="status">
          {t("restored")}
        </p>
      ) : null}
      {syncBlocked ? (
        <p className={`mt-2 ${NOTICE()} px-3 py-1.5 text-micro`} role="status">
          {t("syncBlocked")}
        </p>
      ) : null}
      {refusal && status !== "error" ? (
        <p className={`mt-2 ${NOTICE("critical")} px-3 py-1.5 text-micro`} role="alert">
          {errMsg(refusal, t("error"))}
        </p>
      ) : null}

      {/* The clock the brief promised. Advisory by design: past the box it says so and
          says the time is recorded, and the Submit button never stops working. A
          candidate who ran long has still done the work, and refusing it would delete an
          hour over a limit they were never shown until now. */}
      {elapsedMinutes != null ? (
        <p
          className={
            elapsedMinutes > timeboxMinutes
              ? `mt-2 ${NOTICE()} px-3 py-1.5 text-micro`
              : "mt-2 text-micro text-steel"
          }
        >
          {elapsedMinutes > timeboxMinutes
            ? t("clockOver", { over: duration(elapsedMinutes - timeboxMinutes), timebox: duration(timeboxMinutes) })
            : t("clockElapsed", { elapsed: duration(elapsedMinutes), timebox: duration(timeboxMinutes) })}
        </p>
      ) : null}

      {perturbation ? (
        <div className={`mt-4 ${NOTICE()} p-4`} role="status">
          {/* NOTICE("amber") already carries the tone's text color — restating it
              here was the one place the two could disagree. */}
          <p className="text-meta uppercase">{t("updateHeading")}</p>
          <p className="mt-1 text-body">{perturbation}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => selectFile(f.path)}
                className={`focus-ring w-full truncate rounded px-2 py-2 text-left font-mono text-sm ${toggleBtn(f.path === active?.path)}`}
                title={f.path}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0">
          {/* The full path as visible text: the row buttons truncate, and their
              title= tooltip never fires on touch — without this a phone candidate
              is editing a file they can't fully name. */}
          <p className="mb-1 break-all font-mono text-micro text-steel">{active?.path}</p>
          <textarea
            value={active?.contents ?? ""}
            onChange={(e) => active && onEdit(active.path, e.target.value)}
            onPaste={(e) => {
              // Record paste MAGNITUDE (char count) only — not the content. A single
              // large bulk paste into the watched editor is the in-product
              // paste-from-LLM tell the authenticity scorer now penalizes.
              const n = (e.clipboardData?.getData("text") ?? "").length;
              if (active && n > 0) record("paste", active.path, n);
            }}
            spellCheck={false}
            // pointer-coarse:text-base — any computed size under 16px makes iOS
            // force-zoom the viewport on focus (and it never zooms back out).
            className="focus-ring h-80 w-full resize-y rounded-md border border-stone-200 bg-stone-50 p-3 font-mono text-sm leading-relaxed text-ink caret-coral pointer-coarse:text-base"
            aria-label={active?.path ?? "editor"}
          />
        </div>
      </div>

      <div className={`mt-5 ${PANEL_SUNKEN} p-4`}>
        <h3 className="text-sm font-semibold text-ink">{t("chatHeading")}</h3>
        <p className="mt-1 max-w-prose text-micro text-steel">{t("chatIntro")}</p>
        {/* The roles were declared here with no keyboard behind them: each tab was
            its own Tab stop and no arrow key did anything. The transcript below is
            conditional, so there is no stable panel id these tabs could control —
            `controlsPanel: false` states that instead of shipping a dangling
            aria-controls. */}
        <div {...chatTabs.tablistProps} className="mt-3 flex gap-2" aria-label={t("chatHeading")}>
          {CHAT_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              {...chatTabs.tabProps(ch)}
              className={`focus-ring rounded px-3 py-2 text-sm font-medium ${toggleBtn(chatChannel === ch)}`}
            >
              {ch === "assistant" ? t("tabAssistant") : t("tabStakeholder")}
            </button>
          ))}
        </div>
        {visibleChat.length > 0 ? (
          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
            {visibleChat.map((m, i) => (
              <li
                key={i}
                className={`max-w-prose whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user" ? "ml-auto bg-ink text-white" : `${PANEL} text-ink`
                }`}
              >
                {m.text}
                {m.role === "model" && m.deterministic ? (
                  <span className="mt-1 block text-micro text-steel">{t("chatDeterministicNote")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex gap-2">
          <TextInput
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChat();
              }
            }}
            placeholder={chatChannel === "assistant" ? t("chatPlaceholderAssistant") : t("chatPlaceholderStakeholder")}
            className="flex-1"
            aria-label={t("chatHeading")}
          />
          <button
            type="button"
            onClick={() => void sendChat()}
            disabled={chatState === "sending" || chatInput.trim().length === 0}
            className={`${BTN_SECONDARY} h-10 px-4 disabled:cursor-not-allowed`}
          >
            {chatState === "sending" ? t("chatSending") : t("chatSend")}
          </button>
        </div>
        {chatState === "error" ? (
          <p className={`mt-2 ${NOTICE("critical")} px-3 py-1.5 text-micro`} role="alert">
            {errMsg(chatRefusal, t("chatError"))}
          </p>
        ) : null}
        {chatState === "limited" ? (
          <p className={`mt-2 ${NOTICE()} px-3 py-1.5 text-micro`} role="status">
            {t("chatRateLimited")}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {tApply("fieldName")} <span className="text-coral">*</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </label>
        <label className="block text-sm font-medium text-ink">
          {tApply("fieldContact")} <span className="text-coral">*</span>
          <TextInput
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={tApply("fieldContactPlaceholder")}
            className="mt-1"
          />
          <span className="mt-1 block text-micro font-normal text-steel">{tApply("fieldContactHint")}</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`${BTN_PRIMARY} h-10 px-4 disabled:cursor-not-allowed`}
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
        {status === "error" ? (
          <span className={`${NOTICE("critical")} px-3 py-1.5 text-micro`} role="alert">
            {errMsg(refusal, t(errorKind === "closed" ? "errorClosed" : "error"))}
          </span>
        ) : null}
      </div>
    </section>
  );
}
