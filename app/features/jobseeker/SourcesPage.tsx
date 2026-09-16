"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, Loader2, Plus } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { IconAction } from "@/app/_components/IconAction";
import { Tooltip } from "@/app/_components/Tooltip";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, PAGE_HEADER, PANEL, SECTION, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
import { ArrivalList } from "@/app/features/library/jds/intake/IntakeArrivalMotion";
import { useIdArrival } from "./sourceArrival";
import { SOURCE_TIERS, type JobseekerSource, type SourceTier } from "@/app/_lib/jobseeker/types";
import { AddSourceForm } from "./AddSourceForm";
import { FailureNotice } from "./FailureNotice";
import { SourceCard } from "./SourceCard";
import { callJson, entryForSource, type ApiFailure, type CatalogEntryView, type SourcesPayload } from "./sourcesApi";

// /me/sources — the owner-confirmed acquisition list in its three tiers (ADR 0009 §3).
// Tier A: rights-clean feeds and ATS endpoints, a plain switch. Tier B: boards whose
// robots.txt permits the pages but whose terms forbid automated processing, so the
// switch is an acknowledgement door. Tier C: refused, listed with the reason, no
// control at all. Catalog entries the workspace has not added yet appear in their
// tier with an "Add" button (except per-company ATS vendors, which the header's Add
// form covers by slug).
//
// SERVER-FIRST (loading-choreography.md). `initial` is the snapshot app/me/sources/
// page.tsx read on the server, so the tier sections and the header paint on the first
// frame — this page used to mount empty and flash a three-card grey skeleton on every
// navigation while /me and /me/jobs beside it were server-rendered. There is no
// skeleton branch left: the chrome renders unconditionally, and the background re-read
// below settles behind what is already on screen rather than blanking it.

export function SourcesPage({ initial }: { initial: SourcesPayload }) {
  const t = useTranslations("me.sources");
  const [data, setData] = useState<SourcesPayload>(initial);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<{ id: string; fail: ApiFailure } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Every setState sits in the promise callback (the mount effect calls this; see
  // react-hooks/set-state-in-effect). A failed refresh is a NOTICE over data that is
  // still true, never an empty page: the server already handed us a full snapshot.
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

  // Retry re-issues the SAME read; what is already held (the tier sections, the form's
  // typed state) stays on screen while it runs.
  const retry = useCallback(() => {
    setRetrying(true);
    void load().finally(() => setRetrying(false));
  }, [load]);

  const replace = (next: JobseekerSource) => setData((d) => ({ ...d, sources: d.sources.map((s) => (s.id === next.id ? next : s)) }));
  const append = (next: JobseekerSource) => setData((d) => ({ ...d, sources: [...d.sources, next] }));

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
    // Tier 1 of the choreography: the header, the Add door and the three tier sections
    // are the direct children that cascade in (40/90/140/190ms).
    <div className={`stagger-children ${SECTION}`}>
      <header className={PAGE_HEADER}>
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        {/* The surface's primary action belongs in the header, not in a panel at the
            bottom of the page the reader has to scroll past three tiers to find. */}
        <button type="button" className={`${addOpen ? BTN_SECONDARY : BTN_PRIMARY} h-10 px-4`} aria-expanded={addOpen} aria-controls="add-source-panel" onClick={() => setAddOpen((v) => !v)}>
          <Plus size={16} aria-hidden /> {t("add.title")}
        </button>
      </header>

      <div id="add-source-panel">
        {/* Opens INSIDE the page flow and pushes the tiers down rather than covering
            them — the house Collapse (PipelineMotion), reduced-motion gated. */}
        <Collapse show={addOpen}>
          <AddSourceForm onCreated={append} />
        </Collapse>
        {/* A failed background refresh sits under the header: the tiers below are the
            server's snapshot and stay readable, so this reports a stale view, not an
            empty one. */}
        {loadError ? <FailureNotice failure={loadError} fallback={t("loadError")} onRetry={retry} retrying={retrying} onDismiss={() => setLoadError(null)} className={addOpen ? "mt-4" : ""} /> : null}
      </div>

      {SOURCE_TIERS.map((tier) => {
        const mine = data.sources.filter((s) => s.tier === tier);
        const addedHosts = new Set(data.sources.map((s) => s.host));
        const offered = data.catalog.filter((e) => e.tier === tier && (tier === "C" || (!e.needsCompanyConfig && !addedHosts.has(e.host))));
        return <TierSection key={tier} tier={tier} sources={mine} catalog={data.catalog} offered={offered} adding={adding} addError={addError} onAdd={addFromCatalog} onChange={replace} />;
      })}
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
  const tCommon = useTranslations("me.common");
  // The rows cascade once on first paint and then only a source that was just added
  // animates — an untouched row keeps its element (surface-doctrine §5).
  const arrival = useIdArrival(sources.map((s) => s.id));
  const refusedArrival = useIdArrival(offered.map((e) => e.id));
  return (
    <section aria-labelledby={`tier-${tier}`} data-tier={tier} className="space-y-3">
      {/* ONE heading voice at this level: every section head on this page and on
          /me/scans is the serif h3. The page used to mix it with META_LABEL-styled
          h2s, so two headings of the same rank read as different ranks.
          The tier's explanation used to be a max-w-prose paragraph under EVERY one of
          the three headings. It is now REACHED rather than read: the glyph carries it
          on hover and on focus (surface-doctrine §1) and spends no layout. */}
      <h2 id={`tier-${tier}`} className="flex items-center gap-1 font-serif text-h3 text-ink">
        {t(`tier.${tier}.title`)}
        <IconAction icon={Info} label={tCommon("explain")} hint={t(`tier.${tier}.body`)} side="bottom" size={16} />
      </h2>
      {tier === "C" ? (
        // Refused sources are a MUTED ledger: present, legible, plainly not available.
        // The reason is the pill's tooltip, not a chip full of prose.
        <ul className={`${PANEL} overflow-hidden`}>
          <ArrivalList
            items={offered}
            keyOf={(e) => e.id}
            idOf={(e) => e.id}
            delta={refusedArrival}
            itemClassName="border-b border-stone-100 last:border-0"
            renderItem={(e) => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm opacity-70" data-refused>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                  <span className="font-semibold text-ink">{e.label}</span>
                  <span className="truncate text-steel">{e.host}</span>
                </span>
                <Tooltip label={t("refused", { reason: e.refusedReason ?? "" })} side="left">
                  <Badge tone="neutral" label={t("refusedPill")} />
                </Tooltip>
              </div>
            )}
          />
        </ul>
      ) : (
        <>
          {sources.length === 0 && offered.length === 0 ? <p className="text-sm text-steel">{t(`tier.${tier}.empty`)}</p> : null}
          {sources.length > 0 ? (
            // ONE panel per tier, rows parted by a hairline — planes, not a stack of
            // eight bordered cards (surface-doctrine §2).
            <ul className={`${PANEL} overflow-hidden`}>
              <ArrivalList
                items={sources}
                keyOf={(s) => s.id}
                idOf={(s) => s.id}
                delta={arrival}
                renderItem={(s) => <SourceCard source={s} entry={entryForSource(catalog, s)} onChange={onChange} />}
              />
            </ul>
          ) : null}
          {offered.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t("available")}>
              {offered.map((e) => (
                <li key={e.id} className="flex flex-col gap-1">
                  {/* The host was the button's `title=`, which never reaches a keyboard
                      or a touch reader. A real tooltip does both. */}
                  <Tooltip label={e.host}>
                    <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={adding !== null} onClick={() => onAdd(e)}>
                      {adding === e.id ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Plus size={14} aria-hidden />} {t("addEntry", { label: e.label })}
                    </button>
                  </Tooltip>
                  {addError?.id === e.id ? <FailureNotice failure={addError.fail} fallback={t("add.error")} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
