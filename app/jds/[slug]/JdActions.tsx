"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, History, Pencil, RotateCcw, X } from "lucide-react";

type JdRevision = { id: number; title: string; body: string; created_at: string };

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
  // idea-6a18e0fc — JD edit history: the pre-edit snapshots, with view + revert.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<JdRevision[] | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const loadRevisions = useCallback(async () => {
    setRevLoading(true);
    try {
      const p = (await fetch(`/api/jds/${encodeURIComponent(slug)}/revisions`).then((r) => r.json())) as {
        revisions?: JdRevision[];
      };
      setRevisions(p.revisions ?? []);
    } catch {
      setRevisions([]);
    } finally {
      setRevLoading(false);
    }
  }, [slug]);

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && revisions === null && !revLoading) void loadRevisions();
  };

  const revert = async (id: number) => {
    setReverting(id);
    setError(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the body the page loaded so a revert can't bury an edit made meanwhile.
        body: JSON.stringify({ revisionId: id, baseBody: body }),
      });
      const p = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(p?.error ?? "Revert failed.");
      await loadRevisions(); // a revert adds a snapshot of the just-replaced version
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revert failed.");
    } finally {
      setReverting(null);
    }
  };

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
        <button
          type="button"
          onClick={toggleHistory}
          aria-expanded={historyOpen}
          title="View prior versions of this JD and revert to one"
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
        >
          <History size={13} aria-hidden /> {historyOpen ? "Hide history" : "History"}
        </button>
      </div>

      {historyOpen ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
          {revLoading && revisions === null ? (
            <p className="text-sm text-steel">Loading history…</p>
          ) : !revisions || revisions.length === 0 ? (
            <p className="text-sm text-steel">No prior versions yet — edits and reverts will appear here.</p>
          ) : (
            <ul className="space-y-2">
              {revisions.map((rev) => (
                <li key={rev.id} className="rounded-md border border-stone-100 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{rev.title}</span>
                    <span className="text-steel">· {new Date(rev.created_at).toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === rev.id ? null : rev.id)}
                      className="focus-ring font-semibold text-coral hover:underline"
                    >
                      {expanded === rev.id ? "Hide" : "View"}
                    </button>
                    <button
                      type="button"
                      onClick={() => revert(rev.id)}
                      disabled={reverting !== null}
                      className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      <RotateCcw size={12} aria-hidden /> {reverting === rev.id ? "Reverting…" : "Revert to this"}
                    </button>
                  </div>
                  {expanded === rev.id ? (
                    <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 font-mono text-xs text-ink">
                      {rev.body}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

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
              onClick={() => patch({ title: draftTitle, body: draftBody, baseBody: body }, "save")}
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
