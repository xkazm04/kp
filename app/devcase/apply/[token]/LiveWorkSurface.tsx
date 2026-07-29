"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import type { ProcessEvent, SeedFile } from "@/app/features/tools/devcases/DevTypes";
import { draftStorageKey, encodeDraft, decodeDraft, type LiveWorkDraft } from "./liveWorkDraft";

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
  // else stays retryable. The reference is the submission id echoed back on
  // success, so the candidate leaves with a durable handle on their work.
  const [errorKind, setErrorKind] = useState<"closed" | "generic">("generic");
  const [submissionRef, setSubmissionRef] = useState<string | null>(null);

  // Identity (UAT M9): the live-work surface is the SOLE submit path for workspace
  // cases now, so it collects who to reach — a winning evaluation with no address
  // is an unreachable candidate. Labels reuse the repo-form's `devApply` keys.
  const tApply = useTranslations("devApply");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const contactValid = /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit = name.trim().length > 0 && contactValid && status !== "submitting";

  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
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
    if (startingRef.current) return null;
    startingRef.current = true;
    try {
      const r = await fetch("/api/devcase/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) return null;
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
    } finally {
      startingRef.current = false;
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

  const flush = useCallback(
    async (opts?: { submit?: boolean }) => {
      // Idle-visitor guard (case-sim round 3, verifier's find): the interval used
      // to call ensureSession unconditionally, silently minting a session every
      // 8s for someone who only READ the brief — contradicting the lazy-mint
      // contract above. No session and nothing to send ⇒ nothing to do.
      if (!sessionIdRef.current && pendingRef.current.length === 0) return;
      const sid = await ensureSession();
      if (!sid) return;
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
          body: JSON.stringify({ events: batch, ...(sendFiles ? { files: filesRef.current } : {}) }),
          keepalive: opts?.submit,
        });
        if (r.status === 404 || r.status === 409) {
          // This session id is dead — the row is gone or already submitted
          // (another tab/device won a race). Retrying the SAME id forever would
          // spin without landing; drop it so the next ensureSession() mints a
          // fresh one (which also re-stamps the watermark). The batch + files
          // are still good — they just need a new session to flush into.
          sessionIdRef.current = null;
          pendingRef.current = batch.concat(pendingRef.current);
          persistDraft();
          return;
        }
        if (!r.ok) throw new Error("flush failed");
        if (sendFiles) filesDirtyRef.current = false; // the tree the server holds is current again
        persistDraft();
        // The server decides when the mid-flight update fires; the flush response
        // carries it (and keeps carrying it so a reload re-renders the banner).
        const data = (await r.json().catch(() => null)) as { perturbation?: string | null } | null;
        if (data?.perturbation) setPerturbation(data.perturbation);
      } catch {
        // Network failure (offline, flaky wifi) — re-buffer so an unsent batch
        // isn't lost, and persist locally: the next tick retries once the
        // connection returns; if the tab dies first the draft survives anyway.
        pendingRef.current = batch.concat(pendingRef.current);
        persistDraft();
      }
    },
    [ensureSession, persistDraft]
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
      await flush({ submit: true });
      const sid = sessionIdRef.current;
      if (!sid) {
        setStatus("error");
        return;
      }
      const r = await fetch(`/api/devcase/session/${sid}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: name.trim(), contact: contact.trim() }),
      }).catch(() => null);
      const ok = !!(r && r.ok);
      if (r && r.ok) {
        const payload = (await r.json().catch(() => null)) as { submissionId?: string } | null;
        setSubmissionRef(typeof payload?.submissionId === "string" ? payload.submissionId : null);
      } else {
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
  const [chatChannel, setChatChannel] = useState<"assistant" | "stakeholder">("assistant");
  const [chatMessages, setChatMessages] = useState<{ channel: string; role: "user" | "model"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatState, setChatState] = useState<"idle" | "sending" | "error">("idle");

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatState === "sending") return;
    setChatState("sending");
    setChatMessages((prev) => [...prev, { channel: chatChannel, role: "user", text: message }]);
    setChatInput("");
    try {
      const sid = await ensureSession();
      if (!sid) throw new Error("no session");
      const r = await fetch(`/api/devcase/session/${sid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: chatChannel,
          message,
          currentFile: chatChannel === "assistant" && active ? { path: active.path, contents: active.contents } : null,
        }),
      });
      if (!r.ok) throw new Error("chat failed");
      const data = (await r.json()) as { reply?: string };
      if (data.reply) setChatMessages((prev) => [...prev, { channel: chatChannel, role: "model", text: data.reply! }]);
      setChatState("idle");
    } catch {
      setChatState("error");
    }
  }

  const visibleChat = chatMessages.filter((m) => m.channel === chatChannel);

  if (status === "submitted") {
    return (
      <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-serif text-h3 text-emerald-900">{t("submittedTitle")}</h2>
        <p className="mt-1 text-sm text-emerald-800">{t("submitted")}</p>
        {/* Not a two-line cul-de-sac: say where the reply lands and leave a
            durable reference — the candidate just spent an hour in here. */}
        {contact.trim() ? <p className="mt-2 text-sm text-emerald-800">{t("submittedNext", { contact: contact.trim() })}</p> : null}
        {submissionRef ? <p className="mt-2 text-xs text-emerald-700">{t("submittedRef", { ref: submissionRef })}</p> : null}
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h2 className="font-serif text-h3 text-ink">{t("heading")}</h2>
      <p className="mt-1 max-w-prose text-sm text-steel">{t("intro")}</p>
      {/* Phone advisory (sm:hidden): a timed case started on a phone is a trap —
          say so BEFORE the candidate burns their attempt, without blocking them. */}
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:hidden">
        {t("phoneAdvisory")}
      </p>
      {note ? <p className="mt-2 text-xs text-stone-400">{note}</p> : null}
      {restored ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
          {t("restored")}
        </p>
      ) : null}

      {perturbation ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">
          <p className="text-meta uppercase text-amber-700">{t("updateHeading")}</p>
          <p className="mt-1 text-sm text-amber-900">{perturbation}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => selectFile(f.path)}
                className={`w-full truncate rounded px-2 py-2 text-left font-mono text-sm ${
                  f.path === active?.path ? "bg-stone-900 text-white" : "text-ink hover:bg-stone-100"
                }`}
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
          <p className="mb-1 break-all font-mono text-xs text-steel">{active?.path}</p>
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

      <div className="mt-5 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <h3 className="text-sm font-semibold text-ink">{t("chatHeading")}</h3>
        <p className="mt-1 max-w-prose text-xs text-steel">{t("chatIntro")}</p>
        <div className="mt-3 flex gap-2" role="tablist" aria-label={t("chatHeading")}>
          {(["assistant", "stakeholder"] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              role="tab"
              aria-selected={chatChannel === ch}
              onClick={() => setChatChannel(ch)}
              className={`rounded px-3 py-2 text-sm font-medium ${
                chatChannel === ch ? "bg-stone-900 text-white" : "text-ink hover:bg-stone-100"
              }`}
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
                  m.role === "user" ? "ml-auto bg-stone-900 text-white" : "bg-white text-ink shadow-panel"
                }`}
              >
                {m.text}
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
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {chatState === "sending" ? t("chatSending") : t("chatSend")}
          </button>
        </div>
        {chatState === "error" ? <p className="mt-2 text-xs text-red-700">{t("chatError")}</p> : null}
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
          <span className="mt-1 block text-xs font-normal text-steel">{tApply("fieldContactHint")}</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
        {status === "error" ? (
          <span className="text-sm text-red-700">{t(errorKind === "closed" ? "errorClosed" : "error")}</span>
        ) : null}
      </div>
    </section>
  );
}
