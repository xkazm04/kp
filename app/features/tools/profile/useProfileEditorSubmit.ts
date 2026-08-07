// Save/preview submission state + request split out of ProfileEditor.tsx: owns result/
// loading/error and the POST/PUT to /api/profile. persist=false → dry-run preview (always
// POST, never writes). persist=true → POST a new row (create/duplicate) or PUT the edited row.
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
}) {
  const { t, mode, editingId, sourceAnalysisSlug } = args;
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      const isEdit = persist && mode === "edit" && editingId;
      // Carry the source-analysis slug on any real save (never on a dry-run preview):
      // the route resolves the CV hash + analyzed-at from it and stamps lineage, so a
      // build-from-analysis (POST) or a rebuild-from-latest (PUT) becomes traceable.
      const lineage = persist && sourceAnalysisSlug ? { sourceAnalysisSlug } : {};
      const r = await fetch("/api/profile", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { id: editingId, profile, signals, ...lineage } : { profile, signals, persist, ...lineage }
        ),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(errMsg(payload, t("buildFailedStatus", { status: r.status })));
      setResult(payload as BuildResult);
      if (persist) {
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

  return { result, loading, error, build };
}
