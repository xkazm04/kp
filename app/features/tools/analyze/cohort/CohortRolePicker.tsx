"use client";

// Act 1: the role. A searchable, compact list of the JD library — title, field, seniority,
// and the two counts the library route already knows (people in the role's pipeline, CVs already
// analysed against it). An empty library is a state with a way forward, not an error; a failed
// read says so and offers a retry; a cut library says it is the newest N. In the walkthrough the
// library is the fixture's (useWalkthroughSource) and nothing is fetched.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { BTN_SECONDARY, FIELD, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useCohortRoles, type CohortRole } from "./useCohortLists";
import { useWalkthroughSource } from "./cohortWalkthroughSource";

/** How many roles the list draws before it asks the reader to search. */
const SHOWN = 24;
const ROLE_BTN = `${PANEL} focus-ring flex h-full w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:border-coral/50 dark:hover:-rotate-[0.5deg]`;
const LINK = "font-semibold text-coral underline-offset-2 hover:underline";

export function CohortRolePicker({ onPick }: { onPick: (jdSlug: string, jdTitle: string) => void }) {
  const t = useTranslations("analyzeCohort.shell.role");
  const errorMessage = useErrorMessage();
  const enumLabel = useEnumLabel();
  const walkthrough = useWalkthroughSource();
  const live = useCohortRoles(!walkthrough);
  const { roles, state, truncated, reload } = walkthrough ? { ...live, roles: walkthrough.roles, state: "ready" as const, truncated: false } : live;
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? roles.filter((r) => `${r.title} ${r.company ?? ""}`.toLocaleLowerCase().includes(q)) : roles;
  }, [roles, query]);

  if (state === "loading") return <LoadingGap className="min-h-[16rem]" label={t("loading")} />;
  if (state === "failed") {
    return (
      <div role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body`}>
        {errorMessage({ code: "JD_LIST_FAILED" }, t("failed"))}
        <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-9 bg-white px-4 text-body`}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (roles.length === 0) {
    return (
      <div className={`${PANEL_SUNKEN} space-y-2 p-6`}>
        <p className="text-h3 text-ink">{t("emptyTitle")}</p>
        <p className="text-body text-steel">
          {t.rich("empty", { link: (chunks) => <Link href="/?tab=library" className={LINK}>{chunks}</Link> })}
        </p>
      </div>
    );
  }

  const meta = (r: CohortRole) =>
    [r.roleFamily ? enumLabel("family", r.roleFamily) : null, r.seniority ? enumLabel("seniority", r.seniority) : null, r.company]
      .filter(Boolean)
      .join(" · ");
  return (
    <section aria-labelledby="cohort-role-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id="cohort-role-h" className="font-serif text-h2 text-ink">
          {t("title")}
        </h3>
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">{t("search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className={`${FIELD} h-10 w-full pl-9`} />
        </label>
      </div>
      {truncated ? <p className="text-micro text-steel">{t("truncated", { n: roles.length })}</p> : null}
      {matches.length === 0 ? (
        <p role="status" className="text-body text-steel">
          {t("noMatch", { query: query.trim() })}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("listLabel", { n: matches.length })}>
          {matches.slice(0, SHOWN).map((r) => (
            <li key={r.slug}>
              <button type="button" className={ROLE_BTN} onClick={() => onPick(r.slug, r.title)}>
                <span className="w-full truncate text-h3 text-ink">{r.title}</span>
                <span className="w-full truncate text-micro text-steel">{meta(r) || t("noMeta")}</span>
                <span className="text-micro text-ink">
                  {r.pipeline ? t("inPipeline", { n: r.pipeline.total }) : t("noPipeline")}
                  {r.analysisCount != null ? ` · ${t("analysed", { n: r.analysisCount })}` : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > SHOWN ? <p className="text-micro text-steel">{t("more", { shown: SHOWN, n: matches.length })}</p> : null}
    </section>
  );
}
