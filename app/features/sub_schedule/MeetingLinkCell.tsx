"use client";

import { useState } from "react";
import { Link2, Pencil, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";

// The recruiter's per-interview meeting-link control on the agenda row: a "Join"
// link when set, plus an add/edit popover that PATCHes /api/schedule. On save it
// hands the normalized URL up so the row (and its calendar event) refresh in place.
export function MeetingLinkCell({ token, url, onSaved }: { token: string; url: string | null; onSaved: (url: string | null) => void }) {
  const t = useTranslations("scheduleTab.lifecycle");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setValue(url ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, meetingUrl: value.trim() }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(p.error ?? t("linkError"));
        return;
      }
      onSaved((p.invite?.meetingUrl as string | null) ?? null);
      setEditing(false);
    } catch {
      setError(t("linkError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="relative inline-flex items-center gap-1">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-coral hover:underline">
          <Video size={12} aria-hidden /> {t("join")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={open}
        aria-label={url ? t("editLink") : t("addLink")}
        className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-steel hover:border-coral/40 hover:text-ink"
      >
        {url ? (
          <Pencil size={11} aria-hidden />
        ) : (
          <>
            <Link2 size={12} aria-hidden /> {t("addLink")}
          </>
        )}
      </button>
      {editing ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setEditing(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-stone-200 bg-white p-2 shadow-pop">
            <TextInput
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder={t("linkPlaceholder")}
              aria-label={t("linkPlaceholder")}
              sizeVariant="sm"
              className="py-1"
            />
            {error ? <p className="mt-1 text-xs text-coral">{error}</p> : null}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button type="button" onClick={() => setEditing(false)} className="focus-ring rounded px-2 py-1 text-xs font-semibold text-steel hover:text-ink">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="focus-ring rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                {t("save")}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
