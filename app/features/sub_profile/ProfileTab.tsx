"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { buildUrl } from "@/app/features/tabs";
import { Modal } from "@/app/_components/Modal";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { ArchetypeDef, ProfilePayload } from "./ProfileTypes";
import { ArchetypeManager } from "./ArchetypeManager";
import { CandidateMatrix } from "./CandidateMatrix";
import { ProfileRoster } from "./ProfileRoster";
import { ProfileEditor, type EditorMode } from "./ProfileEditor";

// A note's tone picks its color + a11y role from the mapped status shades (all
// present in the dark ramp). No new primitive — the same red-50/red-700 pattern
// the app already uses, extended with the info (blue) and success (green) mates.
type NoteTone = "info" | "success" | "error";
const NOTE_TONE: Record<NoteTone, string> = {
  info: "bg-blue-50 text-blue-700",
  success: "bg-green-50 text-green-800",
  error: "bg-red-50 text-red-700",
};

type EditorState = {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
  // Set when the editor was opened FROM a saved CV analysis (build-from-analysis or
  // rebuild-from-latest) — carried into the save so lineage is stamped.
  sourceAnalysisSlug?: string | null;
};

// The Profile tab is, first, where the candidate-archetype taxonomy is MANAGED
// (ArchetypeManager) — and, second, an overview of analyzed candidates grouped by
// the archetype they routed to (CandidateMatrix). The candidate-profile editor is
// still reachable (a deep link from the pipeline drawer, or the "Build profile"
// button) but is no longer the centre of gravity.
export function ProfileTab() {
  const t = useTranslations("profile.tab");
  const router = useRouter();
  const params = useSearchParams();
  const [archetypes, setArchetypes] = useState<ArchetypeDef[]>([]);
  const [archLoading, setArchLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // The note channel carries a tone chosen by the producer, not a blanket
  // error-red. A deep link that resolves to nothing (the candidate isn't saved as
  // a profile yet) is a benign status, not a failure — it reads as info. Genuine
  // failures elsewhere (roster delete) keep their own red error state.
  const [note, setNote] = useState<{ text: string; tone: NoteTone } | null>(null);
  // A rebuild whose target profile was hand-edited after it was built: hold the intent
  // and warn (naming the edit date) BEFORE hydrating, so the recruiter chooses whether
  // to overwrite their edits (proceed) or keep them (open as a plain edit). Never a
  // silent clobber.
  const [rebuildWarn, setRebuildWarn] = useState<{ slug: string; profileId: string; editedAt: string | null } | null>(null);
  // Bumped when the roster changes (a delete) so the matrix, a sibling that fetches
  // the same union, refetches instead of showing a just-deleted profile. Only one
  // projection is mounted at a time, so a switch to Matrix always remounts and
  // refetches fresh; the key keeps the two in sync if they ever coexist.
  const [dataRev, setDataRev] = useState(0);
  // One candidate population, two projections behind a List | Matrix toggle (was a
  // stacked ProfileRoster + CandidateMatrix rendering the same population twice).
  // Default List; only the active projection is mounted, so exactly one data read
  // runs at a time. Local state, matching the sibling AnalyzeWorkspace toggle.
  const [projection, setProjection] = useState<"list" | "matrix">("list");
  const reduced = useReducedMotion();

  // Open the editor for a saved profile id — the single "?edit= flow" reused by both
  // the pipeline deep link (below) and the roster's Edit action.
  const openEditor = useCallback(
    (id: string) =>
      fetch(`/api/profile?id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) =>
          setEditor({ mode: "edit", editingId: id, initialPayload: (p.profile?.payload as ProfilePayload) ?? null })
        )
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [t]
  );

  // Open the editor PREFILLED from a saved CV analysis. Build-from-analysis (the
  // matrix) opens it in create mode; rebuild-from-latest (a stale profile's badge)
  // passes the profile id so the same row is updated in place (no duplicate) — in
  // both, `sourceAnalysisSlug` rides into the save so the route stamps lineage. The
  // v2Profile is the analysis's normalized profile dump, hydrated exactly like an
  // edit — reusing the one payload→form mapping, never a second one.
  const openFromAnalysis = useCallback(
    (slug: string, rebuildProfileId: string | null) =>
      fetch(`/api/analyses/${encodeURIComponent(slug)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) => {
          const v2 = (p.analysis?.v2Profile as ProfilePayload | undefined) ?? null;
          setEditor({
            mode: rebuildProfileId ? "edit" : "create",
            editingId: rebuildProfileId,
            initialPayload: v2,
            sourceAnalysisSlug: slug,
          });
        })
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [t]
  );

  // Rebuild-from-latest entry: unlike a first build, this re-points an EXISTING
  // profile — which may have been hand-edited since it was built. Check divergence
  // first (GET /api/profile?id= carries it). If it diverged, raise the warning and let
  // the recruiter decide; otherwise hydrate from the analysis exactly as before.
  const openRebuild = useCallback(
    (slug: string, profileId: string) =>
      fetch(`/api/profile?id=${encodeURIComponent(profileId)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) => {
          const div = p.divergence as { diverged: boolean; editedAt: string | null } | null;
          if (div?.diverged) setRebuildWarn({ slug, profileId, editedAt: div.editedAt });
          else void openFromAnalysis(slug, profileId);
        })
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [openFromAnalysis, t]
  );

  const reloadArchetypes = useCallback(
    () =>
      fetch("/api/archetypes")
        .then((r) => r.json())
        .then((p) => setArchetypes((p.archetypes as ArchetypeDef[]) ?? []))
        .catch(() => undefined)
        .finally(() => setArchLoading(false)),
    []
  );

  useEffect(() => {
    void reloadArchetypes();
  }, [reloadArchetypes]);

  // Deep link from the pipeline (?tab=profile&edit=<candidateId>): open that
  // profile in the editor. Clear the param up front so closing returns here and a
  // refresh doesn't reopen it. No synchronous setState — the editor opens in the
  // fetch continuation — so the effect stays render-safe.
  //
  // Runs ONCE at mount (empty deps), reading the initial `edit` param. The deep link is a
  // one-time intent, and keying this on `params` was self-defeating: router.replace clears
  // the param, which changes `params`, which re-ran the effect — firing the FIRST run's
  // cleanup (alive=false) before its in-flight fetch resolved, so the editor never opened.
  useEffect(() => {
    // Build-from-analysis / rebuild-from-latest deep link (?fromAnalysis=<slug>
    // [&rebuild=<profileId>]) takes precedence: it prefills the editor from a CV
    // analysis and carries lineage. Clear both intent params up front so closing
    // returns here and a refresh doesn't reopen it.
    const fromAnalysis = params.get("fromAnalysis");
    if (fromAnalysis) {
      const rebuild = params.get("rebuild");
      router.replace(buildUrl({ fromAnalysis: null, rebuild: null }, params.toString()), { scroll: false });
      // A rebuild (?rebuild=<id>) goes through the divergence check so a hand-edited
      // profile warns first; a first build-from-analysis hydrates straight away.
      if (rebuild) void openRebuild(fromAnalysis, rebuild);
      else void openFromAnalysis(fromAnalysis, null);
      return;
    }
    const editId = params.get("edit");
    if (!editId) return;
    router.replace(buildUrl({ edit: null }, params.toString()), { scroll: false });
    void openEditor(editId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editor) {
    return (
      <ProfileEditor
        mode={editor.mode}
        editingId={editor.editingId}
        initialPayload={editor.initialPayload}
        sourceAnalysisSlug={editor.sourceAnalysisSlug}
        archetypes={archetypes}
        onCancel={() => setEditor(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {note ? (
        <p role={note.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${NOTE_TONE[note.tone]}`}>
          {note.text}
        </p>
      ) : null}
      <ArchetypeManager archetypes={archetypes} loading={archLoading} onChanged={reloadArchetypes} />

      <div className="space-y-3">
        <SegmentedControl
          label={t("projectionLabel")}
          value={projection}
          onChange={setProjection}
          options={[
            { value: "list", label: t("projectionList") },
            { value: "matrix", label: t("projectionMatrix") },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={projection}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          >
            {projection === "list" ? (
              <ProfileRoster
                onEdit={(id) => void openEditor(id)}
                onChanged={() => setDataRev((v) => v + 1)}
                archivedArchetypeIds={archetypes.filter((a) => a.archived).map((a) => a.id)}
              />
            ) : (
              <CandidateMatrix
                archetypes={archetypes}
                reloadKey={dataRev}
                archivedArchetypeIds={archetypes.filter((a) => a.archived).map((a) => a.id)}
                onEditProfile={(id) => void openEditor(id)}
                onNewProfile={() => setEditor({ mode: "create", editingId: null, initialPayload: null })}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {rebuildWarn ? (
        <Modal
          size="md"
          title={t("rebuildWarnTitle")}
          onClose={() => setRebuildWarn(null)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const { profileId } = rebuildWarn;
                  setRebuildWarn(null);
                  void openEditor(profileId);
                }}
                className="focus-ring h-9 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper"
              >
                {t("rebuildWarnKeep")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const { slug, profileId } = rebuildWarn;
                  setRebuildWarn(null);
                  void openFromAnalysis(slug, profileId);
                }}
                className="focus-ring h-9 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel"
              >
                {t("rebuildWarnProceed")}
              </button>
            </div>
          }
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 p-1.5 text-amber-800" aria-hidden>
              <AlertTriangle size={16} />
            </span>
            <p className="text-body text-steel">
              {rebuildWarn.editedAt
                ? t("rebuildWarnBody", { date: new Date(rebuildWarn.editedAt).toLocaleDateString() })
                : t("rebuildWarnBodyNoDate")}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
