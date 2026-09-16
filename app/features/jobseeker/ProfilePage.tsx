"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JobseekerDialog, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { CvStudio, type StudioDegradation } from "./CvStudio";
import { ProfileImport } from "./ProfileImport";
import { ProfileSummary } from "./ProfileSummary";

// The profile page's state: the seeker's row (null until the first import), and the
// studio dialog that is open over it. Everything the page does is one of three
// moves — import a CV, open/reopen a conversation, or reflect what a conversation
// produced — so the state is exactly those two values.

type StudioState = { dialog: JobseekerDialog; degradation: StudioDegradation | null } | null;

export function ProfilePage({ initial }: { initial: JobseekerProfile | null }) {
  const t = useTranslations("me");
  const locale = useLocale();
  const resolveError = useErrorMessage();
  const [profile, setProfile] = useState<JobseekerProfile | null>(initial);
  const [studio, setStudio] = useState<StudioState>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Reopen the newest OPEN cv_polish dialog, else start one. A closed dialog is
  // reopened read-only from the summary's own list (its transcript is the record).
  const openStudio = useCallback(
    async (existing?: JobseekerDialog) => {
      if (!profile || opening) return;
      setOpening(true);
      setOpenError(null);
      try {
        if (existing) {
          const res = await fetch(`/api/jobseeker/dialogs/${existing.id}`);
          const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog; code?: string } | null;
          if (!res.ok || !body?.dialog) throw body;
          setStudio({ dialog: body.dialog, degradation: null });
          return;
        }
        const list = await fetch(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profile.id)}`);
        const listed = (await list.json().catch(() => null)) as { dialogs?: JobseekerDialog[] } | null;
        const open = (listed?.dialogs ?? []).find((d) => d.kind === "cv_polish" && d.status === "open");
        if (open) {
          setStudio({ dialog: open, degradation: null });
          return;
        }
        const res = await fetch("/api/jobseeker/dialogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "cv_polish", lang: locale }),
        });
        const body = (await res.json().catch(() => null)) as
          | { dialog?: JobseekerDialog; fallbackReason?: string | null; fallbackLang?: string | null; code?: string }
          | null;
        if (!res.ok || !body?.dialog) throw body;
        setStudio({
          dialog: body.dialog,
          degradation: body.fallbackReason ? { reason: body.fallbackReason, lang: body.fallbackLang ?? null } : null,
        });
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : null;
        setOpenError(resolveError({ code }, t("cv.createError")));
      } finally {
        setOpening(false);
      }
    },
    [profile, opening, locale, resolveError, t]
  );

  return (
    <div className="space-y-8">
      <header>
        <p className={EYEBROW}>{t("profile.eyebrow")}</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{profile ? t("profile.intro") : t("import.blurb")}</p>
      </header>

      {profile ? (
        <ProfileSummary
          profile={profile}
          opening={opening}
          openError={openError}
          onOpenStudio={() => void openStudio()}
          onOpenDialog={(d) => void openStudio(d)}
          onReimport={() => setProfile(null)}
          studioOpen={studio !== null}
        />
      ) : (
        <ProfileImport existing={initial} onSaved={setProfile} onCancel={initial ? () => setProfile(initial) : undefined} />
      )}

      {studio && profile ? (
        <CvStudio
          dialog={studio.dialog}
          profile={profile}
          initialDegradation={studio.degradation}
          onDialogChange={(dialog) => setStudio((s) => (s ? { ...s, dialog } : s))}
          onProfileChange={setProfile}
          onClose={() => setStudio(null)}
        />
      ) : null}
    </div>
  );
}
