"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { ProcessEvent, SeedFile } from "@/app/features/tools/devcases/DevTypes";
import { draftStorageKey, encodeDraft, decodeDraft, type LiveWorkDraft } from "./liveWorkDraft";
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

const DECISIONS_FILE = "DECISIONS.md";
const FLUSH_MS = 8000;
const EDIT_DEBOUNCE_MS = 600;

export function LiveWorkSurface({ token, seedFiles, note }: { token: string; seedFiles: SeedFile[]; note: string | null }) {
  const t = useTranslations("devApply.workSurface");
  const [files, setFiles] = useState<SeedFile[]>(() => seedFiles.map((f) => ({ ...f })));
  const [activePath, setActivePath] = useState<string>(seedFiles[0]?.path ?? "");
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  // Why the submit failed: a 410 (intake closed) is TERMINAL — telling the
  // candidate to "try again" against it is a retry loop into a wall. Anything
  // else stays retryable. The reference is the OPAQUE handle the server derives
  // from the submission id (devcase-reference.ts) — the candidate leaves with a
  // durable, quotable handle on their work, and the internal id stays off the page.
  const [errorKind, setErrorKind] = useState<"closed" | "generic">("generic");
  const [submissionRef, setSubmissionRef] = useState<string | null>(null);

  // Identity (UAT M9): the live-work surface is the SOLE submit path for workspace
  // cases now, so it collects who to reach — a winning evaluation with no address
  // is an unreachable candidate. Labels reuse the repo-form's `devApply` keys.
  const tApply = useTranslations("devApply");
  // The candidate's own language, sent with the finalize call so the acknowledgement
  // the shared intake produces is written in it rather than in the server's default.
  const locale = useLocale();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const contactValid = /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit = name.trim().length > 0 && contactValid && status !== "submitting";

  const sessionIdRef = useRef<string | null>(null);
  // The IN-FLIGHT mint, not a boolean. A bare "already starting" flag made
  // ensureSession answer `null` to everyone who asked while the first POST was
  // still on the wire — and `null` is indistinguishable from "minting failed",
  // so a submit (or a chat) issued in that ~200ms window failed with a generic
  // error even though the session was about to exist. Sharing the promise keeps
  // the one-mint-per-session guarantee (the per-token/day quota is untouched)
  // while letting concurrent callers await the same result.
  const startingRef = useRef<Promise<string | null> | null>(null);
  const submittingRef = useRef(false);
  const pendingRef = useRef<ProcessEvent[]>([]);
  const filesRef = useRef(files);
  // Dirty flag (case-sim round 3 — every persona converged on this): the 8s tick
  // used to resend the ENTIRE file tree on every flush, edits or not — linear
  // waste in idle sessions, real money at scale. Files ride a flush only when
  // something actually changed since the last successful send.
  const filesDirtyRef = useRef(false);
  // Mid-flight update (LLM-era controls #5): revealed by the SERVER via the flush
  // response once the session crosses the case's afterMinutes; rendered as a
  // stakeholder banner. The reveal moment is server-recorded in the process log.
  const [perturbation, setPerturbation] = useState<string | null>(null);

  // Local draft persistence (harvested from case-sim round 1's winning submission,
  // 2026-07-17). The server flush is the system of record, but it only lands every
  // FLUSH_MS and can fail for minutes on a flaky connection — while the `files`
  // state and pending event buffer live ONLY in memory. localStorage is the durable
  // copy that survives a reload, a crashed tab, or an offline gap: read once on
  // mount, written on every change, scoped per apply-token so a shared device never
  // bleeds one candidate's draft into another's case.
  const [restored, setRestored] = useState(false);
  // Server-side refusal of this session id for this apply link (403). Never silent:
  // the candidate is told their work is held on this device and how to reconnect.
  const [syncBlocked, setSyncBlocked] = useState(false);
  // Why the SERVER refused, in the candidate's language. The mint used to fail
  // silently — `ensureSession` answered null and nothing reached the screen — so a
  // candidate whose apply link had closed, or whose link had spent its day of
  // sessions, kept typing into a surface that was recording nothing and learnt about
  // it only when Submit failed with the generic line. The refusals now carry codes
  // (REFUSAL_ERRORS), and this is where they are read.
  const [refusal, setRefusal] = useState<ApiErrorPayload | null>(null);
  const errMsg = useErrorMessage();
  const persistDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const draft: LiveWorkDraft = {
        sessionId: sessionIdRef.current,
        files: filesRef.current,
        pending: pendingRef.current,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(draftStorageKey(token), encodeDraft(draft));
    } catch {
      // localStorage can throw (quota, private-browsing lockout) — best-effort
      // backstop, not the only copy; the in-memory buffer + server flush remain.
    }
  }, [token]);

  // Resume-on-mount: runs once, client-only (no localStorage during SSR; reading it
  // during render would desync markup). A brief seed -> restored flash is accepted —
  // silent, permanent loss is the worse failure mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = decodeDraft(window.localStorage.getItem(draftStorageKey(token)));
    if (!draft) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage (SSR-safe), the kp ConversationalApply convention */
    if (draft.files.length > 0) {
      filesDirtyRef.current = true; // restored tree may be newer than the server's copy
      setFiles(draft.files);
    }
    if (draft.sessionId) sessionIdRef.current = draft.sessionId;
    pendingRef.current = draft.pending;
    if (draft.files.length > 0 || draft.pending.length > 0) setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  }, []);

  useEffect(() => {
    // Keep the ref current for the flush callback without re-creating the interval
    // on every keystroke. Synced in an effect (not during render) per react-hooks/refs.
    filesRef.current = files;
    persistDraft();
  }, [files, persistDraft]);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazily mint the session on first interaction — never orphan a session for a
  // visitor who only reads the brief.
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    // A mint is already on the wire — join it instead of reporting failure.
    if (startingRef.current) return startingRef.current;
    const minting = (async (): Promise<string | null> => {
      try {
        const r = await fetch("/api/devcase/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!r.ok) {
          // A refusal, not a fault: 404 (this link is not taking work) and 429 (this
          // link has spent its day of sessions) are both terminal-ish and both have a
          // code. Show it; retrying into a wall silently is the failure being fixed.
          const payload = (await r.json().catch(() => null)) as ApiErrorPayload | null;
          setRefusal(payload?.code ? payload : { code: null, error: null });
          return null;
        }
        setRefusal(null);
        const data = (await r.json()) as { sessionId?: string; watermark?: string };
        sessionIdRef.current = data.sessionId ?? null;
        // Session watermark (LLM-era controls #4): stamp the session reference into
        // the DECISIONS log. Innocuous per-session marker — evaluation scans
        // submissions for FOREIGN marks (a shared/relayed solution). REPLACE any
        // prior mark rather than appending: a restored draft that self-healed onto a
        // fresh session would otherwise carry the dead session's mark and read as
        // circulated work.
        if (data.watermark) {
          filesDirtyRef.current = true; // the stamped tree must reach the server
          setFiles((prev) =>
            prev.map((f) => {
              if (!f.path.endsWith(DECISIONS_FILE) || f.contents.includes(data.watermark!)) return f;
              const stripped = f.contents.replace(/\n?Session ref: wm-[0-9a-f]{10}\n?/g, "\n");
              return { ...f, contents: `${stripped.trimEnd()}\n\nSession ref: ${data.watermark}\n` };
            })
          );
        }
        return sessionIdRef.current;
      } catch {
        return null;
      }
    })();
    startingRef.current = minting;
    try {
      return await minting;
    } finally {
      // Cleared for the first awaiter only; anyone who already grabbed the promise
      // still resolves off it. A failed mint therefore stays retryable next tick.
      startingRef.current = null;
    }
  }, [token]);

  const record = useCallback(
    (kind: ProcessEvent["kind"], path?: string, size?: number) => {
      pendingRef.current.push({ t: Date.now(), kind, path, size });
      persistDraft();
      void ensureSession();
    },
    [ensureSession, persistDraft]
  );

  // Returns whether this flush actually LANDED (the server acknowledged the batch,
  // and the file tree with it when one rode along). The periodic tick ignores the
  // answer — it just retries in 8s — but `submit()` must not seal a session whose
  // final tree never arrived, so the outcome can no longer be swallowed here.
  const flush = useCallback(
    async (opts?: { submit?: boolean }): Promise<boolean> => {
      // Idle-visitor guard (case-sim round 3, verifier's find): the interval used
      // to call ensureSession unconditionally, silently minting a session every
      // 8s for someone who only READ the brief — contradicting the lazy-mint
      // contract above. No session and nothing to send ⇒ nothing to do.
      if (!sessionIdRef.current && pendingRef.current.length === 0) return false;
      const sid = await ensureSession();
      if (!sid) return false;
      const batch = pendingRef.current;
      pendingRef.current = [];
      // Files ride only when dirty (or on submit, which must capture the final
      // tree unconditionally); an idle tick still POSTs the empty batch so the
      // server can deliver the mid-flight update reveal.
      const sendFiles = filesDirtyRef.current || opts?.submit;
      try {
        const r = await fetch(`/api/devcase/session/${sid}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The apply token rides every mutating call: a session id alone is not
          // authority to append events or overwrite the tree (the server re-checks it
          // against the session's owning token and answers 403 otherwise).
          body: JSON.stringify({ token, events: batch, ...(sendFiles ? { files: filesRef.current } : {}) }),
          // NO `keepalive` — the same rule useTranscriptPersistence.ts already
          // documents: keepalive caps the request body at 64KB, and THIS is the
          // one request that must carry the complete final file tree (the server
          // accepts 50 files x 256KB). The submit flush is an ordinary in-page
          // request — `submit()` awaits it and then POSTs again from the same live
          // page — so it never needed to survive an unload, while the cap silently
          // network-errored the submissions of exactly the candidates who wrote the
          // most.
        });
        if (r.status === 403) {
          // The server refused this session id for this link. Say so instead of
          // silently retrying forever: the draft is safe on this device, and a reload
          // reconnects (a fresh session is minted from the token in the URL).
          pendingRef.current = batch.concat(pendingRef.current);
          persistDraft();
          setSyncBlocked(true);
          return false;
        }
        if (r.status === 404 || r.status === 409) {
          // This session id is dead — the row is gone or already submitted
          // (another tab/device won a race). Retrying the SAME id forever would
          // spin without landing; drop it so the next ensureSession() mints a
          // fresh one (which also re-stamps the watermark). The batch + files
          // are still good — they just need a new session to flush into.
          sessionIdRef.current = null;
          pendingRef.current = batch.concat(pendingRef.current);
          persistDraft();
          return false;
        }
        if (!r.ok) throw new Error("flush failed");
        if (sendFiles) filesDirtyRef.current = false; // the tree the server holds is current again
        persistDraft();
        // The server decides when the mid-flight update fires; the flush response
        // carries it (and keeps carrying it so a reload re-renders the banner).
        const data = (await r.json().catch(() => null)) as { perturbation?: string | null } | null;
        if (data?.perturbation) setPerturbation(data.perturbation);
        return true;
      } catch {
        // Network failure (offline, flaky wifi) — re-buffer so an unsent batch
        // isn't lost, and persist locally: the next tick retries once the
        // connection returns; if the tab dies first the draft survives anyway.
        pendingRef.current = batch.concat(pendingRef.current);
        persistDraft();
        return false;
      }
    },
    [ensureSession, persistDraft, token]
  );

  useEffect(() => {
    const iv = setInterval(() => void flush(), FLUSH_MS);
    return () => {
      clearInterval(iv);
      if (editTimer.current) clearTimeout(editTimer.current);
    };
  }, [flush]);

  function selectFile(path: string) {
    if (path === activePath) return;
    setActivePath(path);
    record("open", path);
  }

  function onEdit(path: string, contents: string) {
    filesDirtyRef.current = true;
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, contents } : f)));
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      record(path.endsWith(DECISIONS_FILE) ? "decision_log" : "edit", path);
    }, EDIT_DEBOUNCE_MS);
  }

  async function submit() {
    // Synchronous in-flight guard: setStatus is async, so a fast double Enter/click
    // could dispatch two POSTs before the button visibly disables. The ref flips
    // immediately, so a second call is a no-op until this one settles; reset in the
    // finally so an error is retryable (on success the submit button is gone anyway).
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setStatus("submitting");
    record("submit", activePath);
    try {
      // The final flush is the ONLY thing that puts the candidate's last edits and
      // process events on the server — `saveDevSessionFiles` is a no-op once a
      // session is submitted, so sealing after a failed flush grades them on a
      // stale tree AND deletes their local draft on the way out. Its outcome is
      // now load-bearing: an unlanded flush is a retryable error that leaves the
      // session active, the tree dirty and the draft on disk, so a second click
      // re-sends everything.
      const landed = await flush({ submit: true });
      const sid = sessionIdRef.current;
      if (!landed || !sid) {
        setErrorKind("generic");
        setStatus("error");
        return;
      }
      const r = await fetch(`/api/devcase/session/${sid}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, candidate: name.trim(), contact: contact.trim(), locale }),
      }).catch(() => null);
      const ok = !!(r && r.ok);
      if (r && r.ok) {
        const payload = (await r.json().catch(() => null)) as { reference?: string } | null;
        setSubmissionRef(typeof payload?.reference === "string" ? payload.reference : null);
      } else {
        // The 410 is still what makes this terminal, but the reason now rides a code
        // the catalog can render — the response body used to carry an English sentence
        // hand-copied from REFUSAL_ERRORS.POSTING_CLOSED and no code at all.
        const payload = (await r?.json().catch(() => null)) as ApiErrorPayload | null;
        setRefusal(payload?.code ? payload : null);
        setErrorKind(r?.status === 410 ? "closed" : "generic");
      }
      setStatus(ok ? "submitted" : "error");
      if (ok && typeof window !== "undefined") {
        // A submitted draft is done — clear it so a later visit to this link on
        // this device never resurrects an already-submitted attempt.
        try {
          window.localStorage.removeItem(draftStorageKey(token));
        } catch {
          // best-effort cleanup only
        }
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const active = files.find((f) => f.path === activePath) ?? files[0];

  // Captured chat channels (LLM-era controls #2/#5): assistant + stakeholder.
  // Everything flows through the platform — the dialogue is part of the submission.
  const [chatChannel, setChatChannel] = useState<ChatChannel>("assistant");
  const chatTabs = useTablist({ ids: CHAT_CHANNELS, active: chatChannel, onSelect: setChatChannel, controlsPanel: false });
  // `deterministic` marks a reply produced by the keyless fallback rather than a model.
  // Degrading without keys is a product property here; letting the candidate believe a
  // stub was their stakeholder is not, so the bubble says so.
  const [chatMessages, setChatMessages] = useState<
    { channel: string; role: "user" | "model"; text: string; deterministic?: boolean }[]
  >([]);
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
      const sid = await ensureSession();
      if (!sid) throw new Error("no session");
      const r = await fetch(`/api/devcase/session/${sid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          channel: chatChannel,
          message,
          currentFile: chatChannel === "assistant" && active ? { path: active.path, contents: active.contents } : null,
        }),
      });
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
