"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/tabs";
import type { ArchetypeDef, ProfilePayload } from "./ProfileTypes";
import { ArchetypeManager } from "./ArchetypeManager";
import { CandidateMatrix } from "./CandidateMatrix";
import { ProfileRoster } from "./ProfileRoster";
import { ProfileEditor, type EditorMode } from "./ProfileEditor";

type EditorState = {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
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
  const [note, setNote] = useState<string | null>(null);
  // Bumped when the roster changes (a delete) so the matrix, a sibling that fetches
  // the same union, refetches instead of showing a just-deleted profile.
  const [dataRev, setDataRev] = useState(0);

  // Open the editor for a saved profile id — the single "?edit= flow" reused by both
  // the pipeline deep link (below) and the roster's Edit action.
  const openEditor = useCallback(
    (id: string) =>
      fetch(`/api/profile?id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
        .then((p) =>
          setEditor({ mode: "edit", editingId: id, initialPayload: (p.profile?.payload as ProfilePayload) ?? null })
        )
        .catch(() => setNote(t("deepLinkError"))),
    [t]
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
        archetypes={archetypes}
        onCancel={() => setEditor(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {note ? (
        <p role="status" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {note}
        </p>
      ) : null}
      <ArchetypeManager archetypes={archetypes} loading={archLoading} onChanged={reloadArchetypes} />
      <ProfileRoster onEdit={(id) => void openEditor(id)} onChanged={() => setDataRev((v) => v + 1)} />
      <CandidateMatrix
        archetypes={archetypes}
        reloadKey={dataRev}
        onEditProfile={(id) => void openEditor(id)}
        onNewProfile={() => setEditor({ mode: "create", editingId: null, initialPayload: null })}
      />
    </div>
  );
}
