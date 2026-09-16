import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Markdown } from "@/app/_components/Markdown";
import { BTN_GHOST, PANEL } from "@/app/_components/ui/recipes";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { PrintButton } from "@/app/features/jobseeker/PrintButton";

// /me/cv/print — the polished CV in a print layout. Under /me, so the layout's gate
// is the gate and its rail hides itself for paper (`print:hidden`). A4-friendly:
// one column at 210mm, the reader's own document and nothing else on the sheet.
// Tokens only — the print stylesheet is the same design system on white.
export const instant = false;

export default async function CvPrintPage() {
  const t = await getTranslations("me.print");
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  const markdown = profile?.cvPolishedMd ?? null;

  return (
    <div className="mx-auto max-w-[210mm] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/me" className={`${BTN_GHOST} h-9 px-3`}>
          {t("back")}
        </Link>
        {markdown ? <PrintButton label={t("print")} /> : null}
      </div>
      {markdown ? (
        <article className={`${PANEL} px-8 py-10 print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none`}>
          <Markdown content={markdown} className="text-body leading-7 text-ink" />
        </article>
      ) : (
        <section className={`${PANEL} p-6`}>
          <h1 className="font-serif text-h2 text-ink">{t("title")}</h1>
          <p className="mt-2 text-sm text-steel">{t("none")}</p>
        </section>
      )}
    </div>
  );
}
