"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ScanSearch } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, FIELD, ICON_STICKER, META_LABEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

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
    // An ACTION CARD, not a ghost button over a paragraph. The collapsed entry
    // used to be borderless text with the explanation set below it as prose, so
    // the whole block read as a caption — the one route into the third intake
    // shape looked like something to read rather than something to press. The
    // card puts the mark, the name, the explanation and a chevron inside one
    // pressable target that lifts its border on hover.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring group mt-3 flex w-full items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 text-left transition-colors hover:border-coral/50 dark:rounded-2xl dark:shadow-sticker-sm"
      >
        <span className={`${ICON_STICKER} h-10 w-10 shrink-0 text-coral`}>
          <ScanSearch size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-ink">{t("start")}</span>
          <span className="block text-meta text-steel">{t("startHint")}</span>
        </span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-steel transition-colors group-hover:text-coral" />
      </button>
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
        <button type="button" className={`${BTN_PRIMARY} h-9 px-4 text-sm`} disabled={busy || !trimmed} onClick={submit}>
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
