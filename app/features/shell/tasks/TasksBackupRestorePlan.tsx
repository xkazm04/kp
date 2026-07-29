"use client";

// The restore dry-run plan (table list, destructive-overwrite warning + typed
// confirmation, apply/cancel), split out of TasksBackupCard.tsx so it stays
// under the 200-line file cap. Verbatim markup/logic.
import { AlertTriangle } from "lucide-react";

export type BackupPlan = { tables: { name: string; rows: number; populated: boolean }[]; populated: string[] };

export function TasksBackupRestorePlan({
  plan,
  confirmText,
  setConfirmText,
  confirmWord,
  busy,
  onApply,
  onCancel,
}: {
  plan: BackupPlan;
  confirmText: string;
  setConfirmText: (v: string) => void;
  confirmWord: string;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
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
            This overwrites the entire live database. Type <span className="font-mono font-semibold text-ink">{confirmWord}</span> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              aria-label={`Type ${confirmWord} to confirm the destructive restore`}
              className="focus-ring mt-1 block w-40 rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink caret-coral placeholder:text-steel disabled:opacity-60"
              placeholder={confirmWord}
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
          onClick={onApply}
          disabled={busy || (plan.populated.length > 0 && confirmText.trim().toUpperCase() !== confirmWord)}
          className={`focus-ring rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
            plan.populated.length > 0 ? "bg-coral hover:bg-coral/90" : "bg-ink hover:bg-steel"
          }`}
        >
          {plan.populated.length > 0 ? `Replace ${plan.populated.length} tables & restore` : "Restore"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="focus-ring rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
