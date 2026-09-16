"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, CHIP_QUIET, EYEBROW, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { SOURCE_TIERS, type JobseekerSource, type SourceTier } from "@/app/_lib/jobseeker/types";
import { AddSourceForm } from "./AddSourceForm";
import { SourceCard } from "./SourceCard";
import { callJson, entryForSource, type ApiFailure, type CatalogEntryView, type SourcesPayload } from "./sourcesApi";

// /me/sources — the owner-confirmed acquisition list in its three tiers (ADR 0009 §3).
// Tier A: rights-clean feeds and ATS endpoints, a plain toggle. Tier B: boards whose
// robots.txt permits the pages but whose terms forbid automated processing, so the
// toggle is an acknowledgement door. Tier C: refused, listed with the reason, no
// control at all. Catalog entries the workspace has not added yet appear in their
// tier with an "Add" button (except per-company ATS vendors, which the form below
// covers by slug).

export function SourcesPage() {
  const t = useTranslations("me.sources");
  const resolveError = useErrorMessage();
  const [data, setData] = useState<SourcesPayload | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<{ id: string; fail: ApiFailure } | null>(null);

  // Every setState sits in the promise callback (the mount effect calls this; see
  // react-hooks/set-state-in-effect): the skeleton is `data === null`.
  const load = useCallback(
    () =>
      callJson<SourcesPayload>("/api/jobseeker/sources").then((r) => {
        if (!r.ok) {
          setLoadError(r.fail);
          return;
        }
        setLoadError(null);
        setData(r.body);
      }),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (next: JobseekerSource) => setData((d) => (d ? { ...d, sources: d.sources.map((s) => (s.id === next.id ? next : s)) } : d));
  const append = (next: JobseekerSource) => setData((d) => (d ? { ...d, sources: [...d.sources, next] } : d));

  const addFromCatalog = async (entry: CatalogEntryView) => {
    setAdding(entry.id);
    setAddError(null);
    const r = await callJson<{ source: JobseekerSource }>("/api/jobseeker/sources", { method: "POST", body: JSON.stringify({ catalogId: entry.id }) });
    setAdding(null);
    if (!r.ok) {
      setAddError({ id: entry.id, fail: r.fail });
      return;
    }
    append(r.body.source);
  };

  return (
    <div className="space-y-8">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {loadError ? (
        <div className={`${PANEL} p-4`} role="alert">
          <p className="text-sm text-red-700">{resolveError(loadError, t("loadError"))}</p>
          <button type="button" className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !loadError ? (
        <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${PANEL} p-4`}>
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : null}

      {data
        ? SOURCE_TIERS.map((tier) => {
            const mine = data.sources.filter((s) => s.tier === tier);
            const addedHosts = new Set(data.sources.map((s) => s.host));
            const offered = data.catalog.filter((e) => e.tier === tier && (tier === "C" || (!e.needsCompanyConfig && !addedHosts.has(e.host))));
            return <TierSection key={tier} tier={tier} sources={mine} catalog={data.catalog} offered={offered} adding={adding} addError={addError} onAdd={addFromCatalog} onChange={replace} />;
          })
        : null}

      {data ? <AddSourceForm onCreated={append} /> : null}
    </div>
  );
}

function TierSection({
  tier,
  sources,
  catalog,
  offered,
  adding,
  addError,
  onAdd,
  onChange,
}: {
  tier: SourceTier;
  sources: JobseekerSource[];
  catalog: CatalogEntryView[];
  offered: CatalogEntryView[];
  adding: string | null;
  addError: { id: string; fail: ApiFailure } | null;
  onAdd(entry: CatalogEntryView): void;
  onChange(next: JobseekerSource): void;
}) {
  const t = useTranslations("me.sources");
  const resolveError = useErrorMessage();
  return (
    <section aria-labelledby={`tier-${tier}`} data-tier={tier} className="space-y-3">
      <div>
        <h2 id={`tier-${tier}`} className="font-serif text-h3 text-ink">
          {t(`tier.${tier}.title`)}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-steel">{t(`tier.${tier}.body`)}</p>
      </div>
      {tier === "C" ? (
        <ul className="space-y-2">
          {offered.map((e) => (
            <li key={e.id} className={`${PANEL} flex flex-wrap items-center justify-between gap-2 p-3`} data-refused>
              <div className="min-w-0">
                <span className="font-semibold text-ink">{e.label}</span> <span className="text-sm text-steel">{e.host}</span>
              </div>
              <span className={CHIP_QUIET}>{t("refused", { reason: e.refusedReason ?? "" })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {sources.length === 0 && offered.length === 0 ? <p className="text-sm text-steel">{t(`tier.${tier}.empty`)}</p> : null}
          {sources.length > 0 ? (
            <ul className="space-y-3">
              {sources.map((s) => (
                <SourceCard key={s.id} source={s} entry={entryForSource(catalog, s)} onChange={onChange} />
              ))}
            </ul>
          ) : null}
          {offered.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t("available")}>
              {offered.map((e) => (
                <li key={e.id} className="flex flex-col gap-1">
                  <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={adding !== null} onClick={() => onAdd(e)} title={e.host}>
                    {adding === e.id ? <Loader2 size={13} aria-hidden className="animate-spin" /> : <Plus size={13} aria-hidden />} {t("addEntry", { label: e.label })}
                  </button>
                  {addError?.id === e.id ? (
                    <span className="text-sm text-red-700" role="alert">
                      {resolveError(addError.fail, t("add.error"))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
