"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { downloadFile } from "@/app/_lib/export-utils";
import { notifyDataChanged } from "@/app/features/live-refresh";

// DATA3 — workspace backup/restore from the UI. The complete portable
// dump/restore existed CLI-only (scripts/db-dump.mjs + db-load.mjs); this card
// makes "snapshot before a risky bulk action" and "hand a colleague a
// reproducible demo workspace" one click each. Restore is two-step: pick a
// file → see the dry-run plan (and which live tables would be replaced) →
// explicitly confirm.

type Plan = { tables: { name: string; rows: number; populated: boolean }[]; populated: string[] };

export function BackupCard() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dump, setDump] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  // Destructive whole-database restore needs an explicit typed confirmation, not just
  // a one-click button under a passive warning.
  const [confirmText, setConfirmText] = useState("");
  const CONFIRM_WORD = "REPLACE";

  const reset = () => {
    setPlan(null);
    setDump(null);
    setError(null);
    setConfirmText("");
  };

  const exportWorkspace = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch("/api/workspace/export");
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Export failed (${r.status}).`);
      }
      const text = await r.text();
      downloadFile(`kp-dump-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, text, "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setDone(null);
    setPlan(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const r = await fetch("/api/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dump: parsed }),
      });
      const body = (await r.json().catch(() => null)) as { plan?: Plan; error?: string } | null;
      if (!r.ok || !body?.plan) throw new Error(body?.error || `Couldn't read that file (${r.status}).`);
      setPlan(body.plan);
      setDump(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // re-picking the same file re-fires onChange
    }
  };

  const applyRestore = async () => {
    if (!plan || dump == null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dump, apply: true, replace: plan.populated.length > 0 }),
      });
      const body = (await r.json().catch(() => null)) as { loaded?: { name: string; rows: number }[]; error?: string } | null;
      if (!r.ok || !body?.loaded) throw new Error(body?.error || `Restore failed (${r.status}).`);
      const rows = body.loaded.reduce((n, t) => n + t.rows, 0);
      setDone(`Restored ${body.loaded.length} tables · ${rows} rows. Reload the page to see the restored workspace.`);
      reset();
      notifyDataChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">Backup &amp; restore</h3>
        <span className="text-meta uppercase text-steel">full database</span>
      </div>
      <p className="mt-2 text-sm text-steel">
        One JSON file carries the entire kp database — all data across every workspace (prompt cache and task runner
        state excluded), not a single workspace&apos;s slice. Take a backup before a risky bulk action; restore moves the
        whole database between machines. Per-workspace export/restore will come with workspace data isolation.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void exportWorkspace()}
          disabled={busy}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-60"
        >
          <Download size={13} /> Download backup
        </button>
        <label className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper">
          <Upload size={13} /> Restore from file…
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
            }}
          />
        </label>
        {busy ? <span className="text-sm text-steel">Working…</span> : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-3 rounded-md border border-moss/40 bg-moss/5 px-3 py-2 text-sm font-medium text-moss">
          {done}
        </p>
      ) : null}

      {plan ? (
        <div className="mt-3 space-y-2 rounded-md border border-stone-200 bg-paper/60 p-3">
          <p className="text-sm font-semibold text-ink">
            Restore plan · {plan.tables.length} tables, {plan.tables.reduce((n, t) => n + t.rows, 0)} rows
          </p>
          {plan.populated.length > 0 ? (
            <>
              <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                These live tables already hold data and will be REPLACED by the file: {plan.populated.join(", ")}.
              </p>
              <label className="block text-sm text-steel">
                This overwrites the entire live database. Type <span className="font-mono font-semibold text-ink">{CONFIRM_WORD}</span> to confirm:
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={busy}
                  aria-label={`Type ${CONFIRM_WORD} to confirm the destructive restore`}
                  className="focus-ring mt-1 block w-40 rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink caret-coral placeholder:text-steel disabled:opacity-60"
                  placeholder={CONFIRM_WORD}
                />
              </label>
            </>
          ) : (
            <p className="text-sm text-steel">No live table holds data — the restore is non-destructive.</p>
          )}
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-steel">
            {plan.tables.map((t) => (
              <li key={t.name} className="flex items-baseline justify-between gap-2">
                <span className="font-mono">{t.name}</span>
                <span className="nums">
                  {t.rows} rows{t.populated ? " · replaces live data" : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void applyRestore()}
              disabled={busy || (plan.populated.length > 0 && confirmText.trim().toUpperCase() !== CONFIRM_WORD)}
              className={`focus-ring rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
                plan.populated.length > 0 ? "bg-coral hover:bg-coral/90" : "bg-ink hover:bg-steel"
              }`}
            >
              {plan.populated.length > 0 ? `Replace ${plan.populated.length} tables & restore` : "Restore"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="focus-ring rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
