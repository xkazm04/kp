import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Send, UserPlus } from "lucide-react";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { RecordRecent } from "@/app/features/RecordRecent";
import { getJob, loadJd, type JdRow } from "@/app/_lib/db";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { jdJobId } from "@/app/_lib/jd-limits";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { JdActions } from "./JdActions";
import { JdBody } from "./JdBody";


// First ~155 chars of the JD body, markdown stripped, for the share/search snippet.
function metaDescription(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/[#>*_`~]/g, "") // inline md punctuation
    .replace(/^\s*[-+]\s+/gm, "") // list bullets
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 155 ? `${text.slice(0, 152).trimEnd()}…` : text;
}

// SEO / share metadata for the flagship public JD page — without this a shared link
// (the documented "shareable ?lang=cs links" use case) unfurled as a bare URL with the
// app-default title and was invisible to search. Archived roles return noindex so a
// filled role stops drawing candidate traffic (JDL #4). Pure read; not-found is handled
// by the page's own notFound() below.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  let jd: JdRow | null = null;
  try {
    jd = loadJd(slug);
  } catch {
    jd = null;
  }
  if (!jd) return {};
  const description = metaDescription(jd.body);
  return {
    title: jd.title,
    description,
    openGraph: { title: jd.title, description, type: "website" },
    twitter: { card: "summary", title: jd.title, description },
    // A retired role shouldn't keep ranking / drawing applicants; keep links followable.
    ...(jd.archived_at ? { robots: { index: false, follow: true } } : {}),
  };
}

// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function JdDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Page chrome renders in the VISITOR's locale (getTranslations = the server-side
  // next-intl pattern the other public pages — schedule/[token], interview/[token]
  // — use; locale resolves from the cookie/Accept-Language via getServerLocale).
  // The JD BODY stays in its authored language (JdBody below is not translated).
  const t = await getTranslations("jdPublic");

  // The JD body is the primary, public, shareable content. Load it independently so
  // a transient SQLite error (a locked WAL mid-write, a corrupt row) renders a scoped
  // in-shell message instead of crashing the whole route into the Next error boundary.
  let jd: JdRow | null;
  try {
    jd = loadJd(slug);
  } catch {
    return (
      <WorkspaceShell active="library">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">{t("loadError")}</p>
      </WorkspaceShell>
    );
  }
  if (!jd) notFound();

  // Privacy (biz-ui scan 2026-06-12 #1) — no analyzed-candidate data on this
  // page. It is the public, candidate-facing artifact (Apply CTA below,
  // shareable ?lang=cs links), so the former "Candidates" aside and header
  // count exposed other applicants' names + scores to every candidate sent
  // here. The same listAnalysesByJd list now lives on the recruiter-facing
  // Library tab rows (sub_library/LibraryTab.tsx), lazy-loaded per JD.

  // W8-2 (JDL2) — the JD → apply bridge. The page is the public, shareable
  // candidate-facing artifact, yet a candidate landing here had zero path to
  // apply: the header offered only recruiter actions while the conversational
  // apply flow already existed at /apply/jd-<slug> the moment the role was
  // live. The CTA renders only when the linked job accepts applications (the
  // same isJobOpenForApplications gate the apply surfaces enforce).
  const jobId = jdJobId(slug);
  const linkedJob = getJob(jobId);
  const applyOpen = linkedJob !== null && isJobOpenForApplications(getJobStatus(jobId));

  // This page is public + shareable, so the Edit / Archive / Revert controls must
  // not render for a candidate visiting via the share link. Only an operator sees
  // them (open mode = trusted local; otherwise a valid session). The backing
  // PATCH/revisions routes enforce the same gate server-side.
  const canManage = await isOperator();

  return (
    <WorkspaceShell active="library">
      {/* SHELL3: visiting the detail page IS opening the entity — record it. */}
      <RecordRecent type="jd" id={slug} label={jd.title} href={`/jds/${encodeURIComponent(slug)}`} />
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")} · {slug}</p>
          <h1 className="mt-1 font-serif text-display text-ink">{jd.title}</h1>
          <p className="mt-2 text-sm text-steel">{t("savedAt", { date: new Date(jd.created_at).toLocaleString() })}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:items-end">
          {applyOpen ? (
            <Link
              href={`/apply/${encodeURIComponent(jobId)}`}
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              <UserPlus size={15} /> {t("apply")}
            </Link>
          ) : (
            <span
              className="inline-flex h-10 items-center justify-center rounded-md border border-dashed border-stone-300 px-3 text-sm text-steel"
              title={t("notAcceptingTitle")}
            >
              {t("notAccepting")}
            </span>
          )}
          <button
            type="button"
            disabled
            title={t("publishTitle")}
            className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel opacity-70"
          >
            <Send size={15} /> {t("publish")}
          </button>
          <Link
            href={`/?tab=analyze&jd=${encodeURIComponent(slug)}`}
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
          >
            {t("analyzeCv")}
          </Link>
        </div>
      </header>

      {jd.archived_at ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
          {t("archivedBanner")}
        </p>
      ) : null}

      {canManage ? (
        <JdActions slug={slug} title={jd.title} body={jd.body} archived={Boolean(jd.archived_at)} />
      ) : null}

      <div className="mt-6">
        <JdBody markdown={jd.body} />
      </div>
    </WorkspaceShell>
  );
}
