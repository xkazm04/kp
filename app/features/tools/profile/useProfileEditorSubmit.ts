// Save/preview submission state + request split out of ProfileEditor.tsx: owns result/
// loading/error and the POST/PUT to /api/profile. persist=false → dry-run preview (always
// POST, never writes). persist=true → PUT when this editor session already has a row (an
// edit's editingId, or the id a create's FIRST save returned), else POST a new one.
import { useState } from "react";
import type { useTranslations } from "next-intl";
import type { BuildResult } from "@/app/features/shared/profileTypes";
import { buildProfilePayload } from "./profileEditorPayload";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type Translator = ReturnType<typeof useTranslations>;

export function useProfileEditorSubmit(args: {
  t: Translator;
  mode: "create" | "edit";
  editingId: string | null;
  sourceAnalysisSlug?: string | null;
  /** The row's `updated_at` as the editor LOADED it (GET /api/profile?id= carries it).
   *  Rides into every PUT as `expectedUpdatedAt`; the store re-asserts it in the
   *  UPDATE's WHERE, so a save computed against a version someone else has already
   *  replaced is refused (409) instead of quietly winning the race. */
  initialUpdatedAt?: string | null;
  /** Called once a save actually persisted — the editor drops its sessionStorage
   *  backup there, so a finished intake never springs back into the next session. */
  onPersisted?: () => void;
}) {
  const { t, mode, editingId, sourceAnalysisSlug, initialUpdatedAt, onPersisted } = args;
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row a create-mode save actually wrote. The editor deliberately STAYS OPEN after
  // a save (below) because the result panel's completeness gaps are meant to be worked
  // through — "save → click a gap → fill the field → save" is the designed loop. But
  // `mode` stays "create" for that whole session, so every one of those saves used to
  // POST, and each POST INSERTS: the loop the UI invites filed one extra profile per
  // click, leaving the roster with several half-finished rows for one candidate and no
  // hint which is current. Remembering the id turns every save after the first into the
  // PUT it always meant to be. Never set from a persist:false preview (which writes
  // nothing), and irrelevant in edit mode, which already has an editingId.
  const [createdId, setCreatedId] = useState<string | null>(null);
  // The version this editor is allowed to overwrite. Seeded from the load, advanced by
  // every successful save (so the "save -> fill a gap -> save again" loop keeps working),
  // and null for a create, which INSERTs and has nothing to race.
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(initialUpdatedAt ?? null);
  // True once the server refused a save because the row moved underneath it. The editor
  // answers with a reload affordance rather than an error string: the recruiter's own
  // text is still on screen and must not be thrown away by the message explaining it.
  const [stale, setStale] = useState(false);

  const build = async (
    persist: boolean,
    fields: Parameters<typeof buildProfilePayload>[0] & {
      choice: string;
      isEnrolled: boolean;
      expectedGraduation: string;
      wantsDomainChange: boolean;
      hasSubstantialExperience: boolean;
    }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const profile = buildProfilePayload(fields);

      const signals = {
        selfDeclared: fields.choice,
        isEnrolled: fields.isEnrolled,
        expectedGraduation: fields.expectedGraduation || undefined,
        wantsDomainChange: fields.wantsDomainChange,
        hasSubstantialExperience: fields.hasSubstantialExperience,
      };

      const targetId = mode === "edit" ? editingId : createdId;
      const isEdit = Boolean(persist && targetId);
      // Carry the source-analysis slug on any real save (never on a dry-run preview):
      // the route resolves the CV hash + analyzed-at from it and stamps lineage, so a
      // build-from-analysis (POST) or a rebuild-from-latest (PUT) becomes traceable.
      const lineage = persist && sourceAnalysisSlug ? { sourceAnalysisSlug } : {};
      const r = await fetch("/api/profile", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { id: targetId, profile, signals, expectedUpdatedAt, ...lineage }
            : { profile, signals, persist, ...lineage }
        ),
      });
      const payload = await r.json();
      // The lost-update refusal is not a generic failure: the row was saved by someone
      // (or another tab) after this editor read it, so the honest answer is "reload to
      // see theirs", never a red sentence over a form still holding unsaved text.
      if (r.status === 409 && (payload as { code?: string }).code === "PROFILE_STALE") {
        setStale(true);
        return;
      }
      if (!r.ok) throw new Error(errMsg(payload, t("buildFailedStatus", { status: r.status })));
      const built = payload as BuildResult;
      setResult(built);
      if (persist) {
        // Pin the created row so the NEXT save updates it instead of inserting again.
        if (!targetId && built.saved?.id) setCreatedId(built.saved.id);
        // Advance the version guard to what we just wrote, so the next save in this
        // session is checked against OUR write rather than a stamp from before it.
        // `saved` is typed in app/features/shared/profileTypes as `{ id }`; the route
        // also returns the row's fresh `updated_at` beside it. Read it through a local
        // widening rather than editing the shared type from this lot.
        setExpectedUpdatedAt((built.saved as { id: string; updatedAt?: string | null } | null | undefined)?.updatedAt ?? null);
        onPersisted?.();
        // Stay on the editor and surface the saved result panel — its "Match now"
        // CTA is the one-click build→match loop. (Previously this navigated straight
        // back to the list, so running a match meant 4 clicks across tabs.) The Back
        // button (onCancel) returns to the roster, which refetches on remount.
        toast.success(t("savedToast"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("buildFailed"));
    } finally {
      setLoading(false);
    }
  };

  return { result, loading, error, stale, build };
}
