"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload } from "lucide-react";
import { BTN_SECONDARY, CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { downloadFile } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { OrganizationBackupFlow } from "./OrganizationBackupFlow";
import { OrganizationBackupRestorePlan, type BackupPlan as Plan } from "./OrganizationBackupRestorePlan";

// DATA3 — ORGANIZATION backup/restore from the UI. The portable dump/restore
// existed CLI-only (scripts/db-dump.mjs + db-load.mjs); this panel makes
// "snapshot before a risky bulk action" one click. Restore is two-step: pick a
// file → see the dry-run plan (and how much live data would be replaced) →
// explicitly confirm.
//
// SCOPE: the pair used to move the WHOLE DATABASE, which could not survive
// multi-tenancy and was hard-refused once KP_MULTI_WORKSPACE went on. It now
// covers the caller's ORGANIZATION — every team in it, its people, its billing
// record — and restores IN PLACE, into the deployment the file came from. Two
// things it deliberately does not do, both surfaced in the copy rather than left
// to be discovered: it does not carry integration settings and provider keys
// (deployment secrets, and the six singleton config tables carry no org id), and
// it is not a way to move an organization between deployments.
//
// It used to sit on the Background-tasks tab, beside a health readout and an
// outbound webhook form, because that tab was where the operator-only surfaces
// had collected. Backing up and restoring the database is ORGANIZATION
// administration — the same seam as the org name, the language default and the
// member roster — so it renders under Settings → Organization now, and the file
// lives with the rest of that module.
//
// The copy is deliberately localized (`workspaceAdmin.org.backup`): this is not a
// readout, it is a DESTRUCTIVE workflow whose warning, typed confirmation and
// "will be REPLACED" table list are the only thing standing between an operator
// and losing the database. Comprehension here is a safety property. The table
// NAMES it lists stay verbatim: they are schema identifiers.
//
// The explanation is a DIAGRAM, not a paragraph (OrganizationBackupFlow): the
// four-line intro this panel used to open with had to carry five facts in prose
// and named the internal codename to do it. The two lanes show the artefact
// chain each button walks, the destructive terminal node is coral, and the scope
// facts are three separate lines instead of subordinate clauses.

export function OrganizationBackupPanel() {
  const t = useTranslations("workspaceAdmin.org.backup");
  // A coded failure resolves through the `errors` catalog; the fallbacks below are
  // this panel's own copy. The server's raw `error` must never be what reaches the
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

  // Config the restore could not bring back, reported by the server and shown as
  // its own line: a summary that only counts what WAS restored would let an
  // operator walk away believing their relay and ATS settings came with it.
  const [notCarried, setNotCarried] = useState<string[]>([]);

  const exportWorkspace = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch("/api/workspace/export");
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        throw new Error(errMsg(body, t("exportFailedStatus", { status: r.status })));
      }
      const text = await r.text();
      downloadFile(`kp-org-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, text, "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("exportFailed"));
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
      if (!r.ok || !body?.plan) throw new Error(errMsg(body, t("readFailedStatus", { status: r.status })));
      setPlan(body.plan);
      setDump(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("readFailed"));
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
        body: JSON.stringify({ dump, apply: true, replace: plan.totalExisting > 0 }),
      });
      const body = (await r.json().catch(() => null)) as {
        restored?: { tables: { name: string; deleted: number; inserted: number }[]; notRestored: string[] };
        error?: string;
        code?: string;
      } | null;
      if (!r.ok || !body?.restored) throw new Error(errMsg(body, t("restoreFailedStatus", { status: r.status })));
      const rows = body.restored.tables.reduce((total, tbl) => total + tbl.inserted, 0);
      setDone(t("restored", { tables: body.restored.tables.length, rows }));
      setNotCarried(body.restored.notRestored ?? []);
      reset();
      notifyDataChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("restoreFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <span className={META_LABEL}>{t("meta")}</span>
      </div>
      <p className="mt-2 text-sm text-steel">{t("lede")}</p>

      {/* What the two buttons below actually do, drawn rather than described. */}
      <OrganizationBackupFlow confirmWord={CONFIRM_WORD} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void exportWorkspace()}
          disabled={busy}
          className={`${BTN_SECONDARY} h-8 gap-1.5 px-3 text-sm font-semibold`}
        >
          <Download size={13} aria-hidden /> {t("download")}
        </button>
        <label className={`${BTN_SECONDARY} h-8 cursor-pointer gap-1.5 px-3 text-sm font-semibold`}>
          <Upload size={13} aria-hidden /> {t("restoreFrom")}
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
        {busy ? <span className="text-sm text-steel">{t("working")}</span> : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
      {done ? (
        <div role="status" className="mt-3 rounded-md border border-moss/40 bg-moss/5 px-3 py-2 text-sm">
          <p className="font-medium text-moss">{done}</p>
          {notCarried.length > 0 ? (
            /* Table NAMES stay verbatim in every locale — they are schema identifiers. */
            <p className="mt-1 text-steel">{t("notCarried", { tables: notCarried.join(", ") })}</p>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <OrganizationBackupRestorePlan
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
