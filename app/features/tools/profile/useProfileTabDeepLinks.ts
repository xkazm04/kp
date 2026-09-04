// Archetype registry load + every profile-editor deep-link opener, split out of
// ProfileTab.tsx: build-from-analysis, rebuild-from-latest (with its divergence check),
// and the plain "?edit=<id>" pipeline deep link, plus the one-time mount effect that
// reads those query params.
import { useCallback, useEffect, useState } from "react";
import type { useRouter, ReadonlyURLSearchParams } from "next/navigation";
import type { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import type { ArchetypeDef, ProfilePayload } from "@/app/features/shared/profileTypes";
import type { EditorState, NoteTone, RebuildWarn } from "./ProfileTabTypes";

type Translator = ReturnType<typeof useTranslations>;
type Router = ReturnType<typeof useRouter>;

export function useProfileTabDeepLinks(args: {
  t: Translator;
  router: Router;
  params: ReadonlyURLSearchParams;
  setEditor: (state: EditorState | null) => void;
  setNote: (note: { text: string; tone: NoteTone } | null) => void;
  setRebuildWarn: (warn: RebuildWarn | null) => void;
}) {
  const { t, router, params, setEditor, setNote, setRebuildWarn } = args;
  const [archetypes, setArchetypes] = useState<ArchetypeDef[]>([]);
  const [archLoading, setArchLoading] = useState(true);

  // Open the editor for a saved profile id — the single "?edit= flow" reused by both
  // the pipeline deep link (below) and the roster's Edit action.
  const openEditor = useCallback(
    (id: string) =>
      fetch(`/api/profile?id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) =>
          setEditor({
            mode: "edit",
            editingId: id,
            initialPayload: (p.profile?.payload as ProfilePayload) ?? null,
            // The version this session may overwrite. Without it a save is a
            // last-write-wins race with any other tab holding the same row.
            initialUpdatedAt: (p.updatedAt as string | null) ?? null,
            nonce: Date.now(),
          })
        )
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [t, setEditor, setNote]
  );

  // Open the editor PREFILLED from a saved CV analysis. Build-from-analysis (the
  // matrix) opens it in create mode; rebuild-from-latest (a stale profile's badge)
  // passes the profile id so the same row is updated in place (no duplicate) — in
  // both, `sourceAnalysisSlug` rides into the save so the route stamps lineage. The
  // v2Profile is the analysis's normalized profile dump, hydrated exactly like an
  // edit — reusing the one payload→form mapping, never a second one.
  const openFromAnalysis = useCallback(
    (slug: string, rebuildProfileId: string | null, rebuildUpdatedAt?: string | null) =>
      fetch(`/api/analyses/${encodeURIComponent(slug)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) => {
          const v2 = (p.analysis?.v2Profile as ProfilePayload | undefined) ?? null;
          setEditor({
            mode: rebuildProfileId ? "edit" : "create",
            editingId: rebuildProfileId,
            initialPayload: v2,
            // A rebuild PUTs an existing row, so it carries the same version guard as
            // a plain edit (openRebuild read it one request earlier). A first build
            // POSTs and has nothing to race.
            initialUpdatedAt: rebuildProfileId ? rebuildUpdatedAt ?? null : null,
            sourceAnalysisSlug: slug,
            nonce: Date.now(),
          });
        })
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [t, setEditor, setNote]
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
          const updatedAt = (p.updatedAt as string | null) ?? null;
          if (div?.diverged) setRebuildWarn({ slug, profileId, editedAt: div.editedAt, updatedAt });
          else void openFromAnalysis(slug, profileId, updatedAt);
        })
        .catch(() => setNote({ text: t("deepLinkError"), tone: "info" })),
    [openFromAnalysis, t, setNote, setRebuildWarn]
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

  // Deep link from the pipeline (?tab=archetypes&edit=<candidateId>): open that
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

  return { archetypes, archLoading, openEditor, openFromAnalysis, openRebuild, reloadArchetypes };
}
