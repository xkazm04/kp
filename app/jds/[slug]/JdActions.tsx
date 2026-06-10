"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Pencil, X } from "lucide-react";

// W8-4 (JDL1) — edit + archive for a saved JD, on the page that displays it.
// The library was fully append-only: every revision forked a permanent
// near-duplicate (orphaning the analysis history keyed on jd_slug) and a
// stale JD sat in the Analyze picker forever. Edits PATCH in place — the
// route re-syncs the linked job best-effort — and archive retires the JD
// from lists/pickers while this public page keeps rendering (with the banner
// the server component shows), so existing analysis links never 404.
// English-only like the rest of this report-adjacent surface (RES2's wave).
export function JdActions({ slug, title, body, archived }: { slug: string; title: string; body: string; archived: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const [busy, setBusy] = useState<"save" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (payload: Record<string, unknown>, kind: "save" | "archive") => {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const p = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(p?.error ?? "Save failed.");
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
          >
            <Pencil size={13} aria-hidden /> Edit JD
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => patch({ archived: !archived }, "archive")}
          disabled={busy !== null}
          title={
            archived
              ? "Bring this JD back into the library and the Analyze picker"
              : "Retire this JD from the library and pickers — this page stays up so analysis links keep working"
          }
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          {archived ? <ArchiveRestore size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
          {busy === "archive" ? "Working…" : archived ? "Unarchive" : "Archive"}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-paper/40 p-4">
          <label className="block text-sm font-semibold text-steel">
            Title
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="focus-ring mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-base text-ink"
            />
          </label>
          <label className="block text-sm font-semibold text-steel">
            Body (Markdown)
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={14}
              className="focus-ring mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 font-mono text-sm text-ink"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => patch({ title: draftTitle, body: draftBody }, "save")}
              disabled={busy !== null}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              <Check size={13} aria-hidden /> {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftTitle(title);
                setDraftBody(body);
                setError(null);
              }}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
            >
              <X size={13} aria-hidden /> Cancel
            </button>
            <span className="text-sm text-steel">Edits update the linked role too (its live/draft status is preserved).</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
