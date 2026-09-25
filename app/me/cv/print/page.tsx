import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, PAGE_HEADER, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { CvDesigner } from "@/app/features/jobseeker/cv/CvDesigner";
import { buildCvDocument, isCvAccent, isCvTemplate } from "@/app/features/jobseeker/cv/cvDocument";

// /me/cv/print?template=&accent= — the designed CV at real size. Under /me, so the
// layout's gate is the gate.
//
// Three readers, one render: the seeker (pickers in a print-hidden header, the A4 sheet
// below), the browser's print dialog (only the sheet reaches paper; cv.css owns the
// named @page), and the headless Chromium behind GET /api/jobseeker/cv.pdf, which loads
// this URL with the seeker's cookies and prints it. The sheet is DesignedCv built from the
// seeker's own profile and CV text (cvDocument.ts) — deterministic, keyless, and the
// same component the /me flow previews.
//
// It OPENS like /me does (PAGE_HEADER + EYEBROW / TITLE_DISPLAY / INTRO), so arriving
// here does not read as leaving the product.
export const instant = false;

export default async function CvPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("me.print");
  const [session, ws, params] = await Promise.all([currentSession(), currentWorkspace(), searchParams]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const template = isCvTemplate(params.template) ? params.template : undefined;
  const accent = isCvAccent(params.accent) ? params.accent : undefined;
  const doc = profile && (profile.cvSourceText || (profile.profile.evidence ?? []).length) ? buildCvDocument({ profile: profile.profile, preferences: profile.preferences, cvSourceText: profile.cvSourceText }) : null;

  return (
    <div className="mx-auto max-w-[240mm] px-4 py-8 print:max-w-none print:p-0">
      <header className={`${PAGE_HEADER} mb-6 print:hidden`}>
        <div className="min-w-0">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/me#s-cv" className={`${BTN_GHOST} h-9 px-3`}>
            {t("back")}
          </Link>
        </div>
      </header>
      {doc ? (
        <CvDesigner doc={doc} mode="page" initialTemplate={template} initialAccent={accent} skin={{ primary: `${BTN_PRIMARY} h-9 px-4`, ghost: `${BTN_SECONDARY} h-9 px-4` }} />
      ) : (
        <section className={`${PANEL} p-6`}>
          <p className="text-body text-steel">{t("none")}</p>
        </section>
      )}
    </div>
  );
}
