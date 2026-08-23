"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, FIELD, META_LABEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

// The App-master start option on the intake ledger
// (docs/features/app-master/README.md). This shape does not begin with a blank
// conversation — it begins with an APP, because the one input no JD has ever
// had is the codebase itself. Pointing at it starts a repo scan; the session
// opens bound to that scan and talks while it reads.
//
// Two ways to point: a GitHub URL, or a filesystem path on a self-hosted
// server. The path is accepted only behind the server's own
// `KP_APP_MASTER_REPO_ROOTS` allow-list (fail-closed, never in cloud mode) —
// this form offers it, the scan route decides.

export function JdsIntakeAppMasterStart({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: (repo: { repoUrl?: string; rootPath?: string }) => void;
}) {
  const t = useTranslations("library.tab.intake.appMaster");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "path">("url");
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  if (!open) {
    return (
      <div className="mt-3">
        <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} onClick={() => setOpen(true)}>
          {t("start")}
        </button>
        <p className="mt-1 text-meta text-steel">{t("startHint")}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:rounded-2xl">
      <div className={META_LABEL}>{t("start")}</div>
      <div className={TOGGLE_GROUP}>
        <button type="button" className={toggleBtn(mode === "url")} onClick={() => setMode("url")}>
          {t("repoUrl")}
        </button>
        <button type="button" className={toggleBtn(mode === "path")} onClick={() => setMode("path")}>
          {t("rootPath")}
        </button>
      </div>
      <input
        className={FIELD}
        value={value}
        placeholder={mode === "url" ? t("repoPlaceholder") : t("pathPlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed && !busy) submit();
        }}
      />
      <p className="text-meta text-steel">{mode === "url" ? t("repoHint") : t("pathHint")}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={`${BTN_SECONDARY} h-9 px-4 text-sm`} disabled={busy || !trimmed} onClick={submit}>
          {busy ? t("starting") : t("begin")}
        </button>
        <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} disabled={busy} onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );

  function submit() {
    if (!trimmed || busy) return;
    onStart(mode === "url" ? { repoUrl: trimmed } : { rootPath: trimmed });
  }
}
