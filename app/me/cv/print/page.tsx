import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Markdown } from "@/app/_components/Markdown";
import { BTN_GHOST, EYEBROW, INTRO, PAGE_HEADER, PANEL, SECTION, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { PrintButton } from "@/app/features/jobseeker/PrintButton";

// /me/cv/print — the polished CV in a print layout. Under /me, so the layout's gate
// is the gate; it draws no flow frame, so nothing but the header needs hiding for paper. A4-friendly:
// one column at 210mm, the reader's own document and nothing else on the sheet.
// Tokens only — the print stylesheet is the same design system on white.
//
// It OPENS like /me does: the same PAGE_HEADER + EYEBROW / TITLE_DISPLAY / INTRO trio
// with the actions on its right, so arriving here does not read as leaving the
// product. The whole header is `print:hidden`; on paper the reader's document is the
// only thing on the sheet, at `max-w-prose` on screen so a polished CV is a column
// rather than a full-bleed wall of text.
export const instant = false;

export default async function CvPrintPage() {
  const t = await getTranslations("me.print");
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const markdown = profile?.cvPolishedMd ?? null;

  return (
    <div className={`mx-auto max-w-[210mm] px-4 py-8 ${SECTION} print:space-y-0 print:p-0`}>
      <header className={`${PAGE_HEADER} print:hidden`}>
        <div className="min-w-0">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/me" className={`${BTN_GHOST} h-9 px-3`}>
            {t("back")}
          </Link>
          {markdown ? <PrintButton label={t("print")} /> : null}
        </div>
      </header>
      {markdown ? (
        <article className={`${PANEL} px-8 py-10 print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none`}>
          <Markdown content={markdown} className="mx-auto max-w-prose text-body leading-7 text-ink print:max-w-none" />
        </article>
      ) : (
        <section className={`${PANEL} p-6`}>
          <p className="text-body text-steel">{t("none")}</p>
        </section>
      )}
    </div>
  );
}
