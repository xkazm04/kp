"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { BTN_PRIMARY, EYEBROW, INTRO, PAGE_HEADER, SECTION, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import type { JobseekerDialog, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { CvStudio, type StudioDegradation } from "./CvStudio";
import { FailureNotice } from "./FailureNotice";
import { ProfileImport } from "./ProfileImport";
import { ProfileSummary } from "./ProfileSummary";

// The profile page's state: the seeker's row (null until the first import), and the
// studio dialog that is open over it. Everything the page does is one of three
// moves — import a CV, open/reopen a conversation, or reflect what a conversation
// produced — so the state is exactly those two values.
//
// It OPENS like every other page in the product: PAGE_HEADER carrying the
// EYEBROW / TITLE_DISPLAY / INTRO trio with the surface's primary action on the
// header's right, SECTION for the rhythm below it, `stagger-children` so the header
// and the body arrive in tiers instead of all at once. "Polish my CV" used to be the
// fifth control down inside the summary card; the one thing this page exists to do
// is now the one thing at the top of it.

type StudioState = { dialog: JobseekerDialog; degradation: StudioDegradation | null } | null;

export function ProfilePage({ initial }: { initial: JobseekerProfile | null }) {
  const t = useTranslations("me");
  const locale = useLocale();
  const [profile, setProfile] = useState<JobseekerProfile | null>(initial);
  const [studio, setStudio] = useState<StudioState>(null);
  const [opening, setOpening] = useState(false);
  // The CODE, not a resolved sentence: FailureNotice owns the vocabulary
  // (use-error-message.ts) and offers the retry, so the page never hand-paints a
  // red line the reader cannot act on.
  const [openFailure, setOpenFailure] = useState<{ code: string | null } | null>(null);
  /** Which dialog the last attempt was for, so Retry re-issues the SAME request. */
  const lastAttempt = useRef<JobseekerDialog | undefined>(undefined);

  // Reopen the newest OPEN cv_polish dialog, else start one. A closed dialog is
  // reopened read-only from the summary's own list (its transcript is the record).
  const openStudio = useCallback(
    async (existing?: JobseekerDialog) => {
      if (!profile || opening) return;
      setOpening(true);
      setOpenFailure(null);
      lastAttempt.current = existing;
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
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code ?? null : null;
        setOpenFailure({ code });
      } finally {
        setOpening(false);
      }
    },
    [profile, opening, locale]
  );

  return (
    <>
      <div className={`${SECTION} stagger-children`}>
        <header className={PAGE_HEADER}>
          <div className="min-w-0">
            <p className={EYEBROW}>{t("profile.eyebrow")}</p>
            <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
            <p className={`mt-2 max-w-2xl ${INTRO}`}>{profile ? t("profile.intro") : t("import.blurb")}</p>
          </div>
          {/* The page's primary action. Absent before the first import, where the
              import panel below IS the action and a second door would only compete
              with it. */}
          {profile ? (
            <button type="button" className={`${BTN_PRIMARY} h-10 shrink-0 px-5`} disabled={opening} onClick={() => void openStudio()}>
              <Sparkles size={16} aria-hidden /> {t("cv.open")}
            </button>
          ) : null}
        </header>

        {openFailure ? (
          <FailureNotice
            failure={openFailure}
            fallback={t("cv.createError")}
            retrying={opening}
            onRetry={() => void openStudio(lastAttempt.current)}
            onDismiss={() => setOpenFailure(null)}
          />
        ) : null}

        {profile ? (
          <ProfileSummary
            profile={profile}
            opening={opening}
            onOpenDialog={(d) => void openStudio(d)}
            onReimport={() => setProfile(null)}
            studioOpen={studio !== null}
          />
        ) : (
          <ProfileImport existing={initial} onSaved={setProfile} onCancel={initial ? () => setProfile(initial) : undefined} />
        )}
      </div>

      {/* Outside the staggered column on purpose: the studio is an overlay with its
          own entrance, and a `stagger-children` delay would hold it back. */}
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
    </>
  );
}
