import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Send, UserPlus } from "lucide-react";
import { WorkspaceShell } from "@/app/features/shell/WorkspaceNav";
import { RecordRecent } from "@/app/features/shell/RecordRecent";
import { getJob, getJobWorkspace, getRoleOpenConfig, jdLastEditedAt, loadJd, type JdRow } from "@/app/_lib/db/jobs";
import { listJobTranslations } from "@/app/_lib/db/job-translations";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { postingSourceLang } from "@/app/_lib/job-translate-run";
import { jdJobId } from "@/app/_lib/jd-limits";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jdMarketResearchAvailable } from "@/app/features/library/jds/jdsLibrary";
import { NOTICE } from "@/app/_components/ui/recipes";
import { JdActions } from "./JdActions";
import { JdBody } from "./JdBody";
import { isPublicJdApplyOpen, publicJdAlternates, publicJdHeaderActions } from "./jdPublicHeader";
import {
  loadPublicJdLanguages,
  publicJdRequestedLang,
  publicJdServedView,
  publicJdVariantFor,
  type PublicJdLanguageReads,
} from "./jdPublicVariant";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The owner team's stored posting renderings (jdPublicVariant.ts). Every read is
// bound to the workspace loadPublicJd resolved, never the viewer's: a translation is
// one team's paid rendering, and job_translations has no shared tier.
const PUBLIC_JD_READS: PublicJdLanguageReads = {
  translations: listJobTranslations,
  lastEditedAt: jdLastEditedAt,
  sourceLang: (jobId, workspaceId) => postingSourceLang(getRoleOpenConfig(jobId, workspaceId).postingLangs),
};

// The source language named in the reader's own locale (the MT disclosure).
function languageName(lang: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(lang) ?? lang;
  } catch {
    /* an engine without DisplayNames data still shows the code */
    return lang;
  }
}


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

// Tenancy — WHICH team's JD this public page serves. This is the candidate-facing
// share link and a candidate has no session, so the caller's workspace cannot be the
// authority here: loadJd's defaulted argument pinned every visitor to the default
// team, so once a second team existed, the role they published and shared 404'd for
// the very people they sent the link to (and unfurled as a bare URL). The JD row
// itself is the authority, and the linked `jd-<slug>` opening carries that team
// (/api/jds/save ingests it under the JD's workspace) — so derive the tenant from
// it, with the same by-id resolver the public apply intake uses to file a candidate
// into the OPENING's team. No opening ingested ⇒ the default workspace, i.e.
// unchanged from today. Because loadJd matches on it, a row that comes back is
// always a row that lives in this workspace.
function jdOwnerWorkspace(slug: string): string {
  return getJobWorkspace(jdJobId(slug));
}

// …and the hole that authority leaves. `getJobWorkspace` folds "unknown job id" into
// the DEFAULT workspace, and a JD does not always have an opening: "Save as draft" in
// the builder posts to POST /api/jds, which saves the row and ingests NOTHING, and the
// generate path's `jd-<slug>` ingest is explicitly best-effort (`jobIngested: false`).
// For any team other than the default one that meant the opening-derived lookup missed
// and the recruiter's OWN JD 404'd on its own detail page — the page the Ledger links to.
// So: try the opening's team first (the public authority, unchanged), then fall back to
// the VIEWER's own team. The fallback cannot widen what is public — loadJd matches on the
// workspace we pass, and an anonymous visitor resolves to the DEFAULT workspace, i.e.
// exactly the query that just missed — and it cannot cross tenants, because the only
// other workspace it ever reads is the caller's own session's.
async function loadPublicJd(slug: string): Promise<{ jd: JdRow; owner: string } | null> {
  const opening = jdOwnerWorkspace(slug);
  const fromOpening = loadJd(slug, opening);
  if (fromOpening) return { jd: fromOpening, owner: opening };
  const viewer = await currentWorkspace();
  if (viewer === opening) return null;
  const fromViewer = loadJd(slug, viewer);
  return fromViewer ? { jd: fromViewer, owner: viewer } : null;
}

// SEO / share metadata for the flagship public JD page — without this a shared link
// (the documented "shareable ?lang=cs links" use case) unfurled as a bare URL with the
// app-default title and was invisible to search. Archived roles return noindex so a
// filled role stops drawing candidate traffic (JDL #4). Pure read; not-found is handled
// by the page's own notFound() below.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const { lang } = await searchParams;
  let found: { jd: JdRow; owner: string } | null = null;
  try {
    found = await loadPublicJd(slug);
  } catch {
    found = null;
  }
  if (!found) return {};
  const { jd, owner } = found;
  const archived = Boolean(jd.archived_at);
  // The variant this request serves: the metadata describes THAT document (a Czech
  // share link unfurls with the Czech title), and the alternates name only what ships.
  const langs = loadPublicJdLanguages({ slug, owner, archived }, PUBLIC_JD_READS);
  const view = publicJdServedView({ slug, jd, canManage: false, variant: publicJdVariantFor(langs, lang, archived) });
  const description = metaDescription(view.body);
  return {
    title: view.title,
    description,
    openGraph: { title: view.title, description, type: "website" },
    twitter: { card: "summary", title: view.title, description },
    // A retired role shouldn't keep ranking / drawing applicants; keep links followable.
    ...(archived ? { robots: { index: false, follow: true } } : {}),
    // Always set: metadata merges shallowly, so omitting it would inherit the root
    // layout's four ./?lang= alternates (an archived role sets an empty list).
    alternates: publicJdAlternates(slug, {
      archived,
      sourceLang: langs.sourceLang,
      servedLangs: langs.translations.map((t) => t.lang),
      requested: publicJdRequestedLang(lang),
    }),
  };
}

// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function JdDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;
  // Page chrome renders in the VISITOR's locale (getTranslations = the server-side
  // next-intl pattern the other public pages — schedule/[token], interview/[token]
  // — use; locale resolves from the cookie/Accept-Language via getServerLocale).
  // The JD BODY is the authored original unless an explicit ?lang= names a language
  // the owner team holds a fresh posting translation for (jdPublicVariant.ts).
  const t = await getTranslations("jdPublic");
  const locale = await getLocale();

  // The JD body is the primary, public, shareable content. Load it independently so
  // a transient SQLite error (a locked WAL mid-write, a corrupt row) renders a scoped
  // in-shell message instead of crashing the whole route into the Next error boundary
  // — the owner lookup is a DB read too, so it belongs inside the same guard.
  let found: { jd: JdRow; owner: string } | null;
  try {
    found = await loadPublicJd(slug);
  } catch {
    return (
      <WorkspaceShell active="library">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">{t("loadError")}</p>
      </WorkspaceShell>
    );
  }
  if (!found) notFound();
  const { jd, owner } = found;

  // Privacy (biz-ui scan 2026-06-12 #1) — no analyzed-candidate data on this
  // page. It is the public, candidate-facing artifact (Apply CTA below,
  // shareable ?lang=cs links), so the former "Candidates" aside and header
  // count exposed other applicants' names + scores to every candidate sent
  // here. The same listAnalysesByJd list now lives on the recruiter-facing
  // Library tab rows (features/library/jds/JdsTab.tsx), lazy-loaded per JD.

  // W8-2 (JDL2) — the JD → apply bridge. The page is the public, shareable
  // candidate-facing artifact, yet a candidate landing here had zero path to
  // apply: the header offered only recruiter actions while the conversational
  // apply flow already existed at /apply/jd-<slug> the moment the role was
  // live. The CTA renders only when the linked job accepts applications (the
  // same isJobOpenForApplications gate the apply surfaces enforce).
  const jobId = jdJobId(slug);
  const linkedJob = getJob(jobId);
  // Archived JDs keep this page up (and robots: noindex) so analysis links still
  // resolve, but they must not offer Apply — the banner already says the role is
  // retired. Do not wait on a job-status write; archived_at is the page's own fact.
  const applyOpen = isPublicJdApplyOpen({
    hasLinkedJob: linkedJob !== null,
    jobOpenForApplications: isJobOpenForApplications(getJobStatus(jobId, getJobWorkspace(jobId))),
    archivedAt: jd.archived_at,
  });

  // This page is public + shareable, so the Edit / Archive / Revert controls must
  // not render for a candidate visiting via the share link. Only an operator sees
  // them (open mode = trusted local; otherwise a valid session), and only from the
  // team that owns the JD. That second half matters now that the page resolves ANY
  // team's shared role: the backing PATCH/revisions routes are workspace-scoped, so
  // a visiting team's recruiter — or, in open mode, where isOperator() is true for
  // everyone, a candidate on the share link — would be shown Edit/Archive buttons
  // whose every click comes back "JD not found."
  const canManage = (await isOperator()) && (await currentWorkspace()) === owner;
  // Analyze CV and the job-board Publish teaser are operator tools (the ledger
  // rail already has Analyze). A candidate on the share link must not see them.
  const headerActions = publicJdHeaderActions({ canManage, applyOpen });

  // Which variant this request serves — read with the OWNER team loadPublicJd
  // resolved. A translated variant is served whole (its title + body), disclosed,
  // and carries no operator tools: JdActions edit the original, not the rendering.
  const archived = Boolean(jd.archived_at);
  const langs = loadPublicJdLanguages({ slug, owner, archived }, PUBLIC_JD_READS);
  const view = publicJdServedView({ slug, jd, canManage, variant: publicJdVariantFor(langs, lang, archived) });

  // The lint's salary-suppression seam (JdActions' editor now runs the same live
  // lint as the ledger). This page loads the JD's stored build artifacts
  // (analysis_json), so the input is HONEST — a grounded market band or a ticked
  // market-research build suppresses the missing-salary advisory exactly as the
  // ledger does; a plain draft (no artifacts) lints without suppression.
  let marketResearch = false;
  try {
    const artifacts = jd.analysis_json ? (JSON.parse(jd.analysis_json) as unknown) : null;
    marketResearch = jdMarketResearchAvailable(
      artifacts as { options?: { marketResearch?: boolean }; salary?: unknown } | null
    );
  } catch {
    marketResearch = false;
  }

  return (
    <WorkspaceShell active="library">
      {/* SHELL3: visiting the detail page IS opening the entity — record it. */}
      <RecordRecent type="jd" id={slug} label={jd.title} href={`/jds/${encodeURIComponent(slug)}`} />
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")} · {slug}</p>
          <h1 className="mt-1 font-serif text-display text-ink" lang={view.bodyLang}>{view.title}</h1>
          {/* Bare toLocaleString() runs in NODE here (server component), so it formatted
              the stamp in the SERVER's locale — a cs/de/fr visitor on the share link read
              an en-US date under otherwise fully translated chrome. Pass the resolved
              locale. (The time ZONE is still the server's: next-intl configures none —
              see i18n/request.ts — which is a separate, deliberate open question.) */}
          <p className="mt-2 text-sm text-steel">{t("savedAt", { date: new Date(jd.created_at).toLocaleString(locale) })}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:items-end">
          {headerActions.map((action) => {
            switch (action) {
              case "apply":
                return (
                  <Link
                    key="apply"
                    href={`/apply/${encodeURIComponent(jobId)}`}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
                  >
                    <UserPlus size={15} /> {t("apply")}
                  </Link>
                );
              case "notAccepting":
                return (
                  <span
                    key="notAccepting"
                    className="inline-flex h-10 items-center justify-center rounded-md border border-dashed border-stone-300 px-3 text-sm text-steel"
                    title={t("notAcceptingTitle")}
                  >
                    {t("notAccepting")}
                  </span>
                );
              case "publish":
                return (
                  <button
                    key="publish"
                    type="button"
                    disabled
                    title={t("publishTitle")}
                    className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel opacity-70"
                  >
                    <Send size={15} /> {t("publish")}
                  </button>
                );
              case "analyzeCv":
                return (
                  <Link
                    key="analyzeCv"
                    href={`/?tab=analyze&jd=${encodeURIComponent(slug)}`}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
                  >
                    {t("analyzeCv")}
                  </Link>
                );
            }
          })}
        </div>
      </header>

      {jd.archived_at ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
          {t("archivedBanner")}
        </p>
      ) : null}

      {view.disclosure ? (
        <p role="note" aria-label={t("translatedRegion")} className={`${NOTICE("info")} mt-4 px-4 py-2 text-sm`}>
          {t("translatedNotice", { language: languageName(view.disclosure.fromLang, locale) })} {t("translatedDetail")}{" "}
          <Link href={view.disclosure.originalHref} hrefLang={view.disclosure.fromLang} className="focus-ring font-semibold underline underline-offset-2">
            {t("readOriginal")}
          </Link>
        </p>
      ) : null}

      {view.showActions ? (
        <JdActions slug={slug} title={jd.title} body={jd.body} archived={Boolean(jd.archived_at)} marketResearch={marketResearch} />
      ) : null}

      <div className="mt-6">
        <JdBody markdown={view.body} lang={view.bodyLang} />
      </div>
    </WorkspaceShell>
  );
}
