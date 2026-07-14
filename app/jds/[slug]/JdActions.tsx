"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, History, Pencil, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";

type JdRevision = { id: number; title: string; body: string; created_at: string };

// W8-4 (JDL1) — edit + archive for a saved JD, on the page that displays it.
// The library was fully append-only: every revision forked a permanent
// near-duplicate (orphaning the analysis history keyed on jd_slug) and a
// stale JD sat in the Analyze picker forever. Edits PATCH in place — the
// route re-syncs the linked job best-effort — and archive retires the JD
// from lists/pickers while this public page keeps rendering (with the banner
// the server component shows), so existing analysis links never 404.
// Renders through next-intl (`jdPublic` namespace) so the recruiter controls on
// the public JD page read in the viewer's locale — the page chrome half of
// Direction 2 ("the public JD page speaks the candidate's language").
export function JdActions({ slug, title, body, archived }: { slug: string; title: string; body: string; archived: boolean }) {
  const t = useTranslations("jdPublic");
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
      if (!r.ok) throw new Error(p?.error ?? t("revertFailed"));
      await loadRevisions(); // a revert adds a snapshot of the just-replaced version
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("revertFailed"));
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
      if (!r.ok) throw new Error(p?.error ?? t("saveFailed"));
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"));
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
            <Pencil size={13} aria-hidden /> {t("editJd")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => patch({ archived: !archived }, "archive")}
          disabled={busy !== null}
          title={archived ? t("unarchiveTitle") : t("archiveTitle")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          {archived ? <ArchiveRestore size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
          {busy === "archive" ? t("working") : archived ? t("unarchive") : t("archive")}
        </button>
        <button
          type="button"
          onClick={toggleHistory}
          aria-expanded={historyOpen}
          title={t("historyTitle")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
        >
          <History size={13} aria-hidden /> {historyOpen ? t("hideHistory") : t("history")}
        </button>
      </div>

      {historyOpen ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
          {revLoading && revisions === null ? (
            <p className="text-sm text-steel">{t("historyLoading")}</p>
          ) : !revisions || revisions.length === 0 ? (
            <p className="text-sm text-steel">{t("historyEmpty")}</p>
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
                      {expanded === rev.id ? t("hide") : t("view")}
                    </button>
                    <button
                      type="button"
                      onClick={() => revert(rev.id)}
                      disabled={reverting !== null}
                      className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      <RotateCcw size={12} aria-hidden /> {reverting === rev.id ? t("reverting") : t("revert")}
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
            {t("titleLabel")}
            <TextInput value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm font-semibold text-steel">
            {t("bodyLabel")}
            <TextArea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={14}
              sizeVariant="sm"
              className="mt-1 font-mono"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => patch({ title: draftTitle, body: draftBody, baseBody: body }, "save")}
              disabled={busy !== null}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              <Check size={13} aria-hidden /> {busy === "save" ? t("saving") : t("save")}
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
              <X size={13} aria-hidden /> {t("cancel")}
            </button>
            <span className="text-sm text-steel">{t("linkedNote")}</span>
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
