"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload } from "lucide-react";
import { downloadFile } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { TasksBackupRestorePlan, type BackupPlan as Plan } from "./TasksBackupRestorePlan";

// DATA3 — workspace backup/restore from the UI. The complete portable
// dump/restore existed CLI-only (scripts/db-dump.mjs + db-load.mjs); this card
// makes "snapshot before a risky bulk action" and "hand a colleague a
// reproducible demo workspace" one click each. Restore is two-step: pick a
// file → see the dry-run plan (and which live tables would be replaced) →
// explicitly confirm.
//
// NOT English-by-design (an earlier note here claimed it was, by analogy with the
// sibling operator cards). This is not a readout — it is a DESTRUCTIVE workflow
// whose warning, typed confirmation and "will be REPLACED" table list are the
// only thing standing between an operator and losing the database. Comprehension
// here is a safety property, so the copy reads from `tasks.backup`. The table
// NAMES it lists stay verbatim: they are schema identifiers.

export function BackupCard() {
  const t = useTranslations("tasks");
  // A coded failure resolves through the `errors` catalog; the fallbacks below are
  // this card's own copy. The server's raw `error` must never be what reaches the
  // screen (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
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
        const body = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        throw new Error(errMsg(body, t("backup.exportFailedStatus", { status: r.status })));
      }
      const text = await r.text();
      downloadFile(`kp-dump-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, text, "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("backup.exportFailed"));
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
      const body = (await r.json().catch(() => null)) as { plan?: Plan; error?: string; code?: string } | null;
      if (!r.ok || !body?.plan) throw new Error(errMsg(body, t("backup.readFailedStatus", { status: r.status })));
      setPlan(body.plan);
      setDump(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("backup.readFailed"));
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
      const body = (await r.json().catch(() => null)) as { loaded?: { name: string; rows: number }[]; error?: string; code?: string } | null;
      if (!r.ok || !body?.loaded) throw new Error(errMsg(body, t("backup.restoreFailedStatus", { status: r.status })));
      const rows = body.loaded.reduce((total, tbl) => total + tbl.rows, 0);
      setDone(t("backup.restored", { tables: body.loaded.length, rows }));
      reset();
      notifyDataChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("backup.restoreFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">{t("backup.title")}</h3>
        <span className="text-meta uppercase text-steel">{t("backup.meta")}</span>
      </div>
      <p className="mt-2 text-sm text-steel">{t("backup.intro")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void exportWorkspace()}
          disabled={busy}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-60"
        >
          <Download size={13} /> {t("backup.download")}
        </button>
        <label className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper">
          <Upload size={13} /> {t("backup.restoreFrom")}
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
        {busy ? <span className="text-sm text-steel">{t("backup.working")}</span> : null}
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
        <TasksBackupRestorePlan
          plan={plan}
          confirmText={confirmText}
          setConfirmText={setConfirmText}
          confirmWord={CONFIRM_WORD}
          busy={busy}
          onApply={() => void applyRestore()}
          onCancel={reset}
        />
      ) : null}
    </div>
  );
}
