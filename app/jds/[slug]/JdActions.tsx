"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, History, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import { builderLintFindings } from "@/app/features/library/jds/jdsLibrary";
import { JdLintPanel } from "@/app/features/library/jds/JdsLintPanel";
import { JdRevisionPanel } from "@/app/features/library/jds/JdsRevisionPanel";
import { useJdEditor } from "@/app/features/library/jds/useJdEditor";
import { classifyJdWriteResponse } from "@/app/features/library/jds/jdsEditClient";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// W8-4 (JDL1) — edit + archive for a saved JD, on the page that displays it.
// The library was fully append-only: every revision forked a permanent
// near-duplicate (orphaning the analysis history keyed on jd_slug) and a
// stale JD sat in the Analyze picker forever. Edits PATCH in place — the
// route re-syncs the linked job best-effort — and archive retires the JD
// from lists/pickers while this public page keeps rendering (with the banner
// the server component shows), so existing analysis links never 404.
//
// The edit / revision / revert half now runs on the SAME `useJdEditor` client as
// the ledger's in-modal editor (JdModalEditor), so the two can't drift again:
// this surface previously lacked the live lint panel and the honest 401 gate the
// ledger grew — both are now shared. `marketResearch` feeds the lint's
// salary-suppression seam exactly as the ledger does (derived server-side from
// the JD's stored build artifacts).
//
// Renders through next-intl (`jdPublic` namespace) so the recruiter controls on
// the public JD page read in the viewer's locale — the page chrome half of
// Direction 2 ("the public JD page speaks the candidate's language").
export function JdActions({
  slug,
  title,
  body,
  archived,
  marketResearch,
}: {
  slug: string;
  title: string;
  body: string;
  archived: boolean;
  marketResearch: boolean;
}) {
  const t = useTranslations("jdPublic");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  // Archive is a public-page-only sibling of the edit client; it keeps its own
  // busy flag but shares the editor's error/gate surface below.
  const [archiving, setArchiving] = useState(false);

  // The ONE shared edit client — fetch / baseBody CAS / 401 gate latch / 409
  // conflict / revisions / revert. A successful save leaves edit mode; a revert
  // stays in place, reloads the list (a revert appends a snapshot) and refreshes
  // the rendered body.
  const editor = useJdEditor({
    slug,
    baseBody: body,
    copy: {
      gateReason: t("editGateReason"),
      conflict: t("editConflict"),
      saveError: t("saveFailed"),
      revertError: t("revertFailed"),
    },
    onSaved: () => {
      setEditing(false);
      router.refresh();
    },
    onReverted: () => {
      void editor.loadRevisions();
      router.refresh();
    },
  });

  // Live advisory lint over the edited body — the SAME engine + seam as the
  // ledger editor (the public page holds the JD's stored artifacts, so the
  // salary-suppression input is honest, not a guess).
  const lintFindings = builderLintFindings(draftBody, { marketResearch });

  const archive = async () => {
    setArchiving(true);
    editor.setError(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      // Archive shares the editor's honest 401 gate — a refused write latches the
      // controls rather than showing a generic failure.
      if (classifyJdWriteResponse(r.status, p) === "gate") {
        editor.setError(t("editGateReason"));
        return;
      }
      if (!r.ok) throw new Error(errMsg(p, t("saveFailed")));
      router.refresh();
    } catch (caught) {
      editor.setError(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      setArchiving(false);
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
          onClick={archive}
          disabled={archiving}
          title={archived ? t("unarchiveTitle") : t("archiveTitle")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          {archived ? <ArchiveRestore size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
          {archiving ? t("working") : archived ? t("unarchive") : t("archive")}
        </button>
        <button
          type="button"
          onClick={editor.toggleHistory}
          aria-expanded={editor.historyOpen}
          title={t("historyTitle")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
        >
          <History size={13} aria-hidden /> {editor.historyOpen ? t("hideHistory") : t("history")}
        </button>
      </div>

      {editor.historyOpen ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
          {/* The SAME four states as the ledger editor — this surface used to
              render "no history yet" for a failed fetch too. */}
          <JdRevisionPanel
            revisions={editor.revisions}
            revLoading={editor.revLoading}
            revError={editor.revError}
            onRetry={() => void editor.loadRevisions()}
            reverting={editor.reverting}
            gateBlocked={editor.gateBlocked}
            onRevert={editor.revert}
            gateReason={t("editGateReason")}
            loadingLabel={t("historyLoading")}
            emptyLabel={t("historyEmpty")}
            viewLabel={t("view")}
            hideLabel={t("hide")}
            revertLabel={t("revert")}
            revertingLabel={t("reverting")}
          />
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-paper/40 p-4">
          <label className="block text-sm font-semibold text-steel">
            {t("titleLabel")}
            <TextInput
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={editor.gateBlocked}
              className="mt-1"
            />
          </label>
          <label className="block text-sm font-semibold text-steel">
            {t("bodyLabel")}
            <TextArea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              disabled={editor.gateBlocked}
              rows={14}
              sizeVariant="sm"
              className="mt-1 font-mono"
            />
          </label>

          {/* The wired lint panel — the same advisory seam the ledger editor uses. */}
          {lintFindings.length > 0 ? <JdLintPanel findings={lintFindings} /> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => editor.save(draftTitle, draftBody)}
              disabled={editor.busy || editor.gateBlocked}
              title={editor.gateBlocked ? t("editGateReason") : undefined}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              <Check size={13} aria-hidden /> {editor.busy ? t("saving") : t("save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftTitle(title);
                setDraftBody(body);
                editor.setError(null);
              }}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
            >
              <X size={13} aria-hidden /> {t("cancel")}
            </button>
            <span className="text-sm text-steel">{t("linkedNote")}</span>
          </div>
        </div>
      ) : null}
      {editor.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {editor.error}
          {editor.conflict ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(title);
                  setDraftBody(body);
                  editor.setError(null);
                  router.refresh();
                }}
                className="focus-ring font-semibold text-coral hover:underline"
              >
                {t("editReload")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
