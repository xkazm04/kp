"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, History, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
import { builderLintFindings } from "./jd-library";
import { JdLintPanel } from "./JdLintPanel";

type JdRevision = { id: number; title: string; body: string; created_at: string };

// Direction 1 — "edit where you work": in-place JD editing INSIDE the Ledger's
// detail modal, so a recruiter never has to leave for the public /jds/[slug]
// page to fix wording. It drives the SAME machinery the public JdActions uses —
// PATCH /api/jds/[slug] (content-CAS via baseBody) and the /revisions history +
// revert endpoint — and reuses the wired lint seam (builderLintFindings +
// JdLintPanel).
//
// Operator gate (branch reality): the PATCH/revert routes are requireOperator-
// gated server-side. In this app "operator" means: open mode (KP_OPERATOR_PASSWORD
// unset) → everyone; password set → any valid NON-demo session. The Ledger only
// renders behind the operator-gated workspace, so a real recruiter here IS the
// operator and the write succeeds. The single way to reach this as a non-operator
// is an anonymous demo session viewing the workspace — that PATCH 401s. There is
// no client-side operator signal (the whole workspace is client-rendered and the
// list API is read-only for this context), so rather than invent a new probe
// endpoint we surface the gate HONESTLY on the 401: the controls latch into a
// disabled state carrying the reason, never a silently-failing button.
export function JdModalEditor({
  slug,
  initialTitle,
  initialBody,
  marketResearch,
  onDone,
}: {
  slug: string;
  initialTitle: string;
  initialBody: string;
  // Whether a grounded market-salary band exists — feeds the lint's salaryAvailable
  // suppression exactly as the builder does (the same seam), so a role that carries
  // a band doesn't trip the missing-salary advisory.
  marketResearch: boolean;
  // Refresh the detail + leave edit mode (used by a successful save AND the
  // conflict "Reload latest" recovery).
  onDone: () => void;
}) {
  const t = useTranslations("library.tab");
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const [draftBody, setDraftBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Latched by a 401 — the honest operator gate (see the component note).
  const [gateBlocked, setGateBlocked] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<JdRevision[] | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Live advisory lint over the edited body — the SAME engine + threshold the
  // builder uses (hidden below the min-body length, so a short draft isn't nagged).
  const lintFindings = useMemo(() => builderLintFindings(draftBody, { marketResearch }), [draftBody, marketResearch]);

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

  const save = async () => {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Content-CAS: send the body we loaded so a concurrent edit 409s rather
        // than being silently clobbered.
        body: JSON.stringify({ title: draftTitle, body: draftBody, baseBody: initialBody }),
      });
      if (r.status === 401) {
        setGateBlocked(true);
        setError(t("editGateReason"));
        return;
      }
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (r.status === 409 || p?.code === "conflict") {
        setConflict(true);
        setError(t("editConflict"));
        return;
      }
      if (!r.ok) throw new Error(p?.error ?? t("editSaveError"));
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("editSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const revert = async (id: number) => {
    setReverting(id);
    setError(null);
    setConflict(false);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the body we loaded so a revert can't bury an edit made meanwhile.
        body: JSON.stringify({ revisionId: id, baseBody: initialBody }),
      });
      if (r.status === 401) {
        setGateBlocked(true);
        setError(t("editGateReason"));
        return;
      }
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (r.status === 409 || p?.code === "conflict") {
        setConflict(true);
        setError(t("editConflict"));
        return;
      }
      if (!r.ok) throw new Error(p?.error ?? t("editRevertError"));
      // A successful revert replaces the live JD — reload the detail so the modal
      // shows the restored wording (and the editor re-seeds from it).
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("editRevertError"));
    } finally {
      setReverting(null);
    }
  };

  const disabled = busy || gateBlocked;

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <label className="block text-sm font-semibold text-steel">
          {t("editTitleLabel")}
          <TextInput
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={gateBlocked}
            className="mt-1"
          />
        </label>
        <label className="block text-sm font-semibold text-steel">
          {t("editBodyLabel")}
          <TextArea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            disabled={gateBlocked}
            rows={16}
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
        </label>

        {/* The wired lint panel (J1) — the same advisory seam as the builder. */}
        {lintFindings.length > 0 ? <JdLintPanel findings={lintFindings} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={disabled}
            title={gateBlocked ? t("editGateReason") : undefined}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            <Check size={13} aria-hidden /> {busy ? t("editSaving") : t("editSave")}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
          >
            <X size={13} aria-hidden /> {t("editCancel")}
          </button>
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={historyOpen}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:text-ink"
          >
            <History size={13} aria-hidden /> {historyOpen ? t("editHideHistory") : t("editHistory")}
          </button>
          <span className="text-sm text-steel">{t("editLinkedNote")}</span>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
            {conflict ? (
              <>
                {" "}
                <button type="button" onClick={onDone} className="focus-ring font-semibold text-coral hover:underline">
                  {t("editReload")}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {historyOpen ? (
        <div className="rounded-lg border border-stone-200 bg-paper/40 p-4">
          {revLoading && revisions === null ? (
            <p className="text-sm text-steel">{t("editHistoryLoading")}</p>
          ) : !revisions || revisions.length === 0 ? (
            <p className="text-sm text-steel">{t("editHistoryEmpty")}</p>
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
                      {expanded === rev.id ? t("editRevisionHide") : t("editRevisionView")}
                    </button>
                    <button
                      type="button"
                      onClick={() => revert(rev.id)}
                      disabled={reverting !== null || gateBlocked}
                      title={gateBlocked ? t("editGateReason") : undefined}
                      className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      <RotateCcw size={12} aria-hidden /> {reverting === rev.id ? t("editReverting") : t("editRevert")}
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
    </div>
  );
}
