"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeedFile } from "./SeedFiles";
import type { ProcessEvent } from "@/app/features/sub_dev/DevTypes";

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

  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingRef = useRef<ProcessEvent[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
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
      const data = (await r.json()) as { sessionId?: string };
      sessionIdRef.current = data.sessionId ?? null;
      return sessionIdRef.current;
    } catch {
      return null;
    } finally {
      startingRef.current = false;
    }
  }, [token]);

  const record = useCallback(
    (kind: ProcessEvent["kind"], path?: string) => {
      pendingRef.current.push({ t: Date.now(), kind, path });
      void ensureSession();
    },
    [ensureSession]
  );

  const flush = useCallback(
    async (opts?: { submit?: boolean }) => {
      const sid = await ensureSession();
      if (!sid) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      try {
        const r = await fetch(`/api/devcase/session/${sid}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch, files: filesRef.current }),
          keepalive: opts?.submit,
        });
        if (!r.ok) throw new Error("flush failed");
      } catch {
        // Re-buffer so an unsent batch isn't lost (best-effort).
        pendingRef.current = batch.concat(pendingRef.current);
      }
    },
    [ensureSession]
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
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, contents } : f)));
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      record(path.endsWith(DECISIONS_FILE) ? "decision_log" : "edit", path);
    }, EDIT_DEBOUNCE_MS);
  }

  async function submit() {
    setStatus("submitting");
    record("submit", activePath);
    await flush({ submit: true });
    const sid = sessionIdRef.current;
    if (!sid) {
      setStatus("error");
      return;
    }
    const r = await fetch(`/api/devcase/session/${sid}/submit`, { method: "POST" }).catch(() => null);
    setStatus(r && r.ok ? "submitted" : "error");
  }

  const active = files.find((f) => f.path === activePath) ?? files[0];

  if (status === "submitted") {
    return (
      <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-serif text-h3 text-emerald-900">{t("submittedTitle")}</h2>
        <p className="mt-1 text-sm text-emerald-800">{t("submitted")}</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h2 className="font-serif text-h3 text-ink">{t("heading")}</h2>
      <p className="mt-1 max-w-prose text-sm text-steel">{t("intro")}</p>
      {note ? <p className="mt-2 text-xs text-stone-400">{note}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => selectFile(f.path)}
                className={`w-full truncate rounded px-2 py-1 text-left font-mono text-xs ${
                  f.path === active?.path ? "bg-stone-900 text-white" : "text-ink hover:bg-stone-100"
                }`}
                title={f.path}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
        <textarea
          value={active?.contents ?? ""}
          onChange={(e) => active && onEdit(active.path, e.target.value)}
          spellCheck={false}
          className="h-80 w-full resize-y rounded-md border border-stone-300 bg-stone-50 p-3 font-mono text-xs leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-stone-400"
          aria-label={active?.path ?? "editor"}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={status === "submitting"}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
        {status === "error" ? <span className="text-sm text-red-700">{t("error")}</span> : null}
      </div>
    </section>
  );
}
