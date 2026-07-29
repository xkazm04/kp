"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { ArchetypeManager } from "./ArchetypeManager";
import { CandidateMatrix } from "./CandidateMatrix";
import { ProfileRoster } from "./ProfileRoster";
import { ProfileTabRebuildWarnModal } from "./ProfileTabRebuildWarnModal";
import { useProfileTabDeepLinks } from "./useProfileTabDeepLinks";
import { NOTE_TONE, type EditorState, type NoteTone, type RebuildWarn } from "./ProfileTabTypes";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): the editor is a click-only surface (a
// deep link, "New profile", or a roster/matrix row action) — never the tab's
// first paint — and it's a heavy form (~450 lines), so it gets its own chunk.
// The loading gap is a quiet reserved box, never a skeleton; it resolves fast
// enough in practice that the 150ms reveal-quiet delay usually hides it entirely.
const ProfileEditor = dynamic(() => import("./ProfileEditor").then((m) => ({ default: m.ProfileEditor })), {
  loading: () => <div className="reveal-quiet min-h-[30rem]" aria-hidden />,
});

// The Profile tab is, first, where the candidate-archetype taxonomy is MANAGED
// (ArchetypeManager) — and, second, an overview of analyzed candidates grouped by
// the archetype they routed to (CandidateMatrix). The candidate-profile editor is
// still reachable (a deep link from the pipeline drawer, or the "Build profile"
// button) but is no longer the centre of gravity.
export function ProfileTab() {
  const t = useTranslations("profile.tab");
  const router = useRouter();
  const params = useSearchParams();
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
  const [rebuildWarn, setRebuildWarn] = useState<RebuildWarn | null>(null);
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

  const { archetypes, archLoading, openEditor, openFromAnalysis, reloadArchetypes } = useProfileTabDeepLinks({
    t,
    router,
    params,
    setEditor,
    setNote,
    setRebuildWarn,
  });

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
    // Tier 1: header-less tab (ArchetypeManager/roster carry their own chrome), so
    // the two real sections cascade in as this wrapper's direct children
    // (stagger-children, globals.css). aria-busy covers the archetype registry's
    // first load only — a later refresh (onChanged) never blanks what's on screen.
    <div className="stagger-children space-y-5" aria-busy={archLoading}>
      {note ? (
        <p role={note.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${NOTE_TONE[note.tone]}`}>
          {note.text}
        </p>
      ) : null}
      <ArchetypeManager archetypes={archetypes} loading={archLoading} onChanged={reloadArchetypes} />

      <div className="space-y-3">
        {/* The create CTA sits NEXT TO the projection toggle, not inside either
            projection, so "Build candidate profile" is reachable from List and
            Matrix alike (it used to live only in the Matrix header). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label={t("projectionLabel")}
            value={projection}
            onChange={setProjection}
            options={[
              { value: "list", label: t("projectionList") },
              { value: "matrix", label: t("projectionMatrix") },
            ]}
          />
          <button
            type="button"
            onClick={() => setEditor({ mode: "create", editingId: null, initialPayload: null })}
            className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-paper"
          >
            <Plus size={15} /> {t("newProfile")}
          </button>
        </div>
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
                archetypes={archetypes}
                onNewProfile={() => setEditor({ mode: "create", editingId: null, initialPayload: null })}
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
        <ProfileTabRebuildWarnModal
          rebuildWarn={rebuildWarn}
          onClose={() => setRebuildWarn(null)}
          onKeep={(profileId) => {
            setRebuildWarn(null);
            void openEditor(profileId);
          }}
          onProceed={(slug, profileId) => {
            setRebuildWarn(null);
            void openFromAnalysis(slug, profileId);
          }}
        />
      ) : null}
    </div>
  );
}
