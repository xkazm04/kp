"use client";

// The restore dry-run plan (table list, destructive-overwrite warning + typed
// confirmation, apply/cancel), split out of OrganizationBackupPanel.tsx so it
// stays under the 200-line file cap.
//
// Moved here from app/features/shell/tasks/ with the panel it belongs to: backing
// up and restoring is organization administration, not a background-task readout,
// so it lives beside the organization console it now renders under.
//
// The plan is per-table `rows` (what the file carries) against `existing` (what the
// restore would DELETE first). Both numbers matter and neither substitutes for the
// other: a table with 0 rows in the file and 4,000 live is the one that empties.
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

export type BackupPlan = {
  tables: { name: string; rows: number; existing: number }[];
  totalRows: number;
  totalExisting: number;
  /** False when another organization shares this deployment, so the shared template
   *  library and decision baseline are left alone. Said out loud, not inferred. */
  sharedTierRestored: boolean;
};

export function OrganizationBackupRestorePlan({
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
  const t = useTranslations("workspaceAdmin.org.backup");
  // "Destructive" is decided by what the restore would DELETE, not by how many
  // tables the file names — a plan can carry thousands of rows and destroy nothing
  // (a fresh organization), or carry none and empty a live table.
  const replacing = plan.tables.filter((tbl) => tbl.existing > 0);
  const destructive = plan.totalExisting > 0;
  return (
    <div className="mt-3 space-y-2 rounded-md border border-stone-200 bg-paper/60 p-3">
      <p className="text-sm font-semibold text-ink">
        {t("plan.title", { tables: plan.tables.length, rows: plan.totalRows })}
      </p>
      {!plan.sharedTierRestored ? <p className="text-sm text-steel">{t("plan.sharedTierNote")}</p> : null}
      {destructive ? (
        <>
          <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {/* Table names are schema identifiers — listed verbatim in every locale. */}
            {t("plan.replaceWarning", { count: plan.totalExisting, tables: replacing.map((tbl) => tbl.name).join(", ") })}
          </p>
          <label className="block text-sm text-steel">
            {t.rich("plan.confirmPrompt", {
              word: confirmWord,
              code: (chunks) => <span className="font-mono font-semibold text-ink">{chunks}</span>,
            })}
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              aria-label={t("plan.confirmAria", { word: confirmWord })}
              className="focus-ring mt-1 block w-40 rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink caret-coral placeholder:text-steel disabled:opacity-60"
              placeholder={confirmWord}
            />
          </label>
        </>
      ) : (
        <p className="text-sm text-steel">{t("plan.nonDestructive")}</p>
      )}
      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-steel">
        {plan.tables.map((tbl) => (
          <li key={tbl.name} className="flex items-baseline justify-between gap-2">
            <span className="font-mono">{tbl.name}</span>
            <span className="nums">
              {tbl.existing > 0 ? t("plan.rowsReplacing", { count: tbl.rows, live: tbl.existing }) : t("plan.rows", { count: tbl.rows })}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={busy || (destructive && confirmText.trim().toUpperCase() !== confirmWord)}
          className={`focus-ring rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
            destructive ? "bg-coral hover:bg-coral/90" : "bg-ink hover:bg-steel"
          }`}
        >
          {destructive ? t("plan.applyReplace", { count: plan.totalExisting }) : t("plan.apply")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="focus-ring rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel hover:bg-paper disabled:opacity-60"
        >
          {t("plan.cancel")}
        </button>
      </div>
    </div>
  );
}
