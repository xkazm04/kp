"use client";

import { useState } from "react";
import { Check, CornerDownLeft, Terminal, X } from "lucide-react";
import { useTranslations } from "next-intl";

type PreviewRow = { id: string; label: string; score: number | null; jobTitle: string | null; stage: string };
type CommandResult =
  | { phase: "preview"; kind: string; description: string; mutating: boolean; preview: PreviewRow[]; total: number | null }
  | { phase: "info"; description: string }
  | { phase: "done"; description: string; count?: number; summary?: { advanced: number; rejected: number; held: number } };

// Natural-language pipeline command bar (#7). The recruiter types a command; it's
// parsed server-side and PREVIEWED (nothing runs) until they confirm. Every action
// maps to the existing guarded pipeline/automation paths — this is a parse + preview
// convenience, not a new privilege. `onExecuted` refreshes the board after a run.
export function CommandBar({ onExecuted }: { onExecuted: () => void }) {
  const t = useTranslations("pipeline.command");
  const [text, setText] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (confirm: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/api/pipeline/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, confirm }),
      });
      const p = await r.json();
      if (p.error) {
        setResult({ phase: "info", description: p.error });
      } else if (confirm || p.executed) {
        setResult({ phase: "done", description: p.description, count: p.count, summary: p.summary });
        onExecuted();
      } else if (p.kind === "help" || p.kind === "unknown") {
        setResult({ phase: "info", description: p.description });
      } else {
        setResult({ phase: "preview", kind: p.kind, description: p.description, mutating: p.mutating, preview: p.preview ?? [], total: p.total });
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setText("");
  };

  return (
    <div className="rounded-md border border-stone-200 bg-white p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) void post(false);
        }}
        className="flex items-center gap-2"
      >
        <Terminal size={15} className="shrink-0 text-steel" />
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (result) setResult(null);
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="focus-ring min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-stone-400"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-meta font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          <CornerDownLeft size={13} /> {t("run")}
        </button>
      </form>

      {result?.phase === "info" ? (
        <div className="mt-2 border-t border-stone-100 pt-2 text-sm text-steel">
          <p>{result.description}</p>
          <p className="mt-1 text-meta text-stone-400">{t("examples")}</p>
        </div>
      ) : null}

      {result?.phase === "preview" ? (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <p className="text-sm text-ink">{result.description}</p>
          {result.total != null ? (
            <p className="mt-1 text-meta text-steel">{t("affects", { count: result.total })}</p>
          ) : null}
          {result.preview.length > 0 ? (
            <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto" role="list">
              {result.preview.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-2 text-meta">
                  <span className="text-ink">{row.label}</span>
                  <span className="shrink-0 text-steel">
                    {row.score != null ? `${row.score}%` : "—"} · {row.jobTitle ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || (result.total === 0 && result.kind !== "run_policy")}
              onClick={() => void post(true)}
              className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-white disabled:opacity-40 ${
                result.kind === "reject_below" ? "bg-red-600 hover:opacity-90" : "bg-coral hover:opacity-90"
              }`}
            >
              <Check size={13} /> {busy ? t("running") : t("confirm")}
            </button>
            <button
              type="button"
              onClick={reset}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:text-ink"
            >
              <X size={13} /> {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {result?.phase === "done" ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-moss">
            <Check size={14} />
            {result.summary
              ? t("doneSummary", { advanced: result.summary.advanced, rejected: result.summary.rejected, held: result.summary.held })
              : t("doneCount", { count: result.count ?? 0 })}
          </span>
          <button type="button" onClick={reset} className="focus-ring text-meta font-semibold text-steel hover:text-ink">
            {t("dismiss")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
