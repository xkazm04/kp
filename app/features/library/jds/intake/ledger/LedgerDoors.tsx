"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Info, Plus, ScanSearch, X } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { Tooltip } from "@/app/_components/Tooltip";
import { BTN_PRIMARY, FIELD, META_LABEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

// THE DOORS — the two ways a run STARTS, drawn as doors rather than described.
//
// The shipped head explains itself twice: a dotted-underlined title whose
// tooltip is the product pitch, and, below it, an action card whose second line
// is a two-sentence paragraph about what App master does. A returning recruiter
// reads neither and pays for both in vertical space above the one thing they
// came for. Here the title stands alone with one glyph door beside it, and the
// second door carries its name and a chevron with the explanation one hover
// away.

/** The plane's head: what this is, and the door to a new run. */
export function LedgerHead({ busy, onNew }: { busy: boolean; onNew: () => void }) {
  const t = useTranslations("library.tab.intake");
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-200 pb-2">
      <h3 className="min-w-0 truncate font-serif text-h2 text-ink">{t("ledgerTitle")}</h3>
      <IconAction
        icon={Plus}
        label={t("new")}
        hint={busy ? t("starting") : null}
        disabled={busy}
        side="left"
        onClick={onNew}
      />
    </div>
  );
}

/** The third shape does not start from a blank conversation — it starts from an
 *  APP (docs/features/app-master/README.md). A titled door, its explanation in
 *  the tooltip; the form it opens keeps every field the card had and moves both
 *  mode hints onto one glyph. */
export function LedgerAppMasterDoor({
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

  const submit = () => {
    if (!trimmed || busy) return;
    onStart(mode === "url" ? { repoUrl: trimmed } : { rootPath: trimmed });
  };

  if (!open) {
    return (
      <Tooltip label={`${t("start")} — ${t("startHint")}`} side="bottom" className="mt-3 w-full">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring group flex w-full items-center gap-3 border-b border-stone-200 py-2.5 text-left text-steel transition-colors hover:text-ink"
        >
          <ScanSearch size={16} aria-hidden className="shrink-0 text-coral" />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{t("start")}</span>
          <ChevronRight size={15} aria-hidden className="shrink-0 transition-colors group-hover:text-coral" />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-b border-stone-200 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className={META_LABEL}>{t("start")}</span>
        <span className="flex items-center gap-1">
          {/* The two mode hints — which URLs work, which paths a self-hosted
              server will accept — are a tooltip on one glyph, not two lines of
              caption under a field. */}
          <IconAction icon={Info} label={t(mode === "url" ? "repoHint" : "pathHint")} side="left" size={15} tone="muted" />
          <IconAction icon={X} label={t("cancel")} side="left" size={15} disabled={busy} onClick={() => setOpen(false)} />
        </span>
      </div>
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
        aria-label={t(mode === "url" ? "repoUrl" : "rootPath")}
        placeholder={mode === "url" ? t("repoPlaceholder") : t("pathPlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button type="button" className={`${BTN_PRIMARY} h-9 px-4 text-sm`} disabled={busy || !trimmed} onClick={submit}>
        {busy ? t("starting") : t("begin")}
      </button>
    </div>
  );
}
