"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, CHIP, CHIP_QUIET, FIELD, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN, STAT_VALUE } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_ARENAS, type Gig, type GigArena, type GigAttempt, type GigKpi } from "@/app/_lib/gigs/types";
import { rateView, specialistEdgeIndex, type SpecialistRow } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { EdgeSwatch, markForGig, MarkLegend, MarkRow, OutcomeMark, RateLine, sentMarks } from "./GigsMarks";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The specialists, as a full page: each one composed from registry recipes pinned at a
// version (or the built-in seed map when the registry was unavailable - said on the
// card), hired through the shared agent hire path, with its record as the verdicts on
// work the operator sent and every gig it holds on the line (each a door to that gig's
// page). Opened from a specialist edge on the line, that specialist's card is marked and
// brought into view; opened from "hire one", the form starts on that arena.

export function GigsSpecialists({
  specialists,
  kpi,
  gigs,
  attemptsByGig,
  initialArena,
  focusId,
  onOpenGig,
  onChanged,
}: {
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  initialArena: GigArena | null;
  /** The specialist the page was opened on, if any. */
  focusId: string | null;
  onOpenGig: (gigId: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "start" });
  }, [focusId]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-h2 text-ink">{t("specialists.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("specialists.lede")}</p>
      </div>
      <HireForm initialArena={initialArena} onChanged={onChanged} />
      <MarkLegend />
      {specialists.length === 0 ? (
        <div className={`${PANEL_SUNKEN} px-6 py-8 text-center`}>
          <p className="font-serif text-h3 text-ink">{t("specialists.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("specialists.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {specialists.map((s) => (
            <SpecialistCard
              key={s.id}
              s={s}
              edge={specialistEdgeIndex(specialists, s.id)}
              kpi={kpi}
              gigs={gigs}
              attemptsByGig={attemptsByGig}
              focused={s.id === focusId}
              cardRef={s.id === focusId ? focusRef : undefined}
              onOpenGig={onOpenGig}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpecialistCard({
  s,
  edge,
  kpi,
  gigs,
  attemptsByGig,
  focused,
  cardRef,
  onOpenGig,
}: {
  s: SpecialistRow;
  edge: number;
  kpi: GigKpi | null;
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  focused: boolean;
  cardRef?: Ref<HTMLElement>;
  onOpenGig: (gigId: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const cell = kpi?.bySpecialist[s.id];
  const r = rateView(cell);
  const mine = Object.values(attemptsByGig).filter((a) => a.specialistId === s.id);
  const count = (...st: GigAttempt["status"][]) => mine.filter((a) => st.includes(a.status)).length;
  const onLine = gigs.filter((g) => (attemptsByGig[g.id]?.specialistId ?? g.specialistId) === s.id);
  return (
    <article
      ref={cardRef}
      aria-current={focused ? "true" : undefined}
      className={`${PANEL} scroll-mt-4 space-y-3 p-5 ${focused ? "outline outline-2 outline-offset-2 outline-coral" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <EdgeSwatch index={edge} className="h-5" />
        <span className={`${CHIP} text-xs`}>{fmt.arena(s.spec.arena)}</span>
        <span className={`${CHIP_QUIET} text-xs`}>{s.registry === "available" ? t("specialists.fromRegistry") : t("specialists.fromSeed")}</span>
      </div>
      <div>
        <h3 className="font-serif text-h3 text-ink">{s.name}</h3>
        <p className="text-sm text-steel">{t("specialists.niche", { niche: s.spec.niche, family: s.spec.taxonomyFamily })}</p>
      </div>
      <div>
        <p className={`${STAT_VALUE} text-ink`}>{r.measured ? t("rate.fraction", { accepted: r.accepted, resolved: r.resolved }) : <Absent>{t("rate.unmeasured")}</Absent>}</p>
        <div className="mt-1">
          <RateLine cell={cell} lead={false} />
        </div>
        <div className="mt-2">
          <MarkRow marks={sentMarks(gigs, attemptsByGig, (_g, a) => a.specialistId === s.id)} emptyLabel={t("specialists.nothingSent")} />
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-steel">{t("specialists.hire")}</dt>
        <dd className="text-ink">{s.hire ? t("specialists.hireLine", { status: fmt.hireStatus(s.hire.status), persona: s.hire.personaName ?? t("specialists.noPersona") }) : <Absent>{t("specialists.noHire")}</Absent>}</dd>
        <dt className="text-steel">{t("specialists.waitingOnYou")}</dt>
        <dd className="text-ink nums">{t("specialists.draftsCount", { count: count("drafted", "approved") })}</dd>
        <dt className="text-steel">{t("specialists.withIt")}</dt>
        <dd className="text-ink nums">{t("specialists.withItLine", { running: count("dispatched", "running"), revision: count("revision_requested") })}</dd>
        <dt className="text-steel">{t("specialists.costPerAccepted")}</dt>
        <dd className="text-ink nums">
          {cell?.costPerAcceptedUsd == null ? <Absent>{t("specialists.noCostPerAccepted")}</Absent> : fmt.usd(cell.costPerAcceptedUsd)}
          {cell && cell.costUnreported > 0 ? <span className="text-steel">{` · ${t("specialists.costUnreported", { count: cell.costUnreported })}`}</span> : null}
        </dd>
        <dt className="text-steel">{t("specialists.budget")}</dt>
        <dd className="text-ink nums">{t("specialists.budgetLine", { budget: fmt.usd(s.spec.budgetUsdPerAttempt) })}</dd>
        <dt className="text-steel">{t("specialists.connectors")}</dt>
        <dd className="text-ink">{s.spec.connectors.length ? s.spec.connectors.join(", ") : <Absent>{t("specialists.noConnectors")}</Absent>}</dd>
      </dl>
      <div>
        <p className={META_LABEL}>{t("specialists.recipes")}</p>
        <ul className="mt-1 space-y-0.5 font-mono text-sm text-steel">
          {s.spec.recipes.map((rc) => (
            <li key={rc.slug} className="break-all">
              {`${rc.slug}@${rc.version}`}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className={META_LABEL}>{t("specialists.onTheLine")}</p>
        {onLine.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("specialists.nothingOnLine")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-dotted divide-stone-200">
            {onLine.map((g) => {
              const mark = markForGig(g, attemptsByGig[g.id] ?? null);
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => onOpenGig(g.id)} className="focus-ring flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-sm hover:text-coral">
                    <span className="min-w-0 break-words font-semibold text-ink">{g.title}</span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-steel">
                      {mark ? <OutcomeMark kind={mark} /> : null}
                      {fmt.status(g.status)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}

function HireForm({ initialArena, onChanged }: { initialArena: GigArena | null; onChanged: () => Promise<unknown> }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [arena, setArena] = useState<GigArena>(initialArena ?? "oss_bounty");
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function hire() {
    if (!niche.trim()) {
      setError(t("specialists.nicheRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson("/api/gigs/specialists", "POST", { arena, niche: niche.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("specialists.hireFailed")));
      return;
    }
    setDone(res.body?.reused === true ? t("specialists.reused") : t("specialists.hired"));
    setNiche("");
    await onChanged();
  }

  return (
    <form
      className={`${PANEL} flex flex-wrap items-end gap-3 p-4`}
      onSubmit={(e) => {
        e.preventDefault();
        void hire();
      }}
    >
      <label className="text-sm text-ink">
        <span className="block font-semibold">{t("specialists.arena")}</span>
        <select value={arena} onChange={(e) => setArena(e.target.value as GigArena)} className={`${FIELD} mt-1`}>
          {GIG_ARENAS.map((a) => (
            <option key={a} value={a}>
              {fmt.arena(a)}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[14rem] flex-1 text-sm text-ink">
        <span className="block font-semibold">{t("specialists.nicheLabel")}</span>
        <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("specialists.nichePlaceholder")} maxLength={80} className={`${FIELD} mt-1 w-full`} />
      </label>
      <button type="submit" disabled={busy} className={`${BTN_PRIMARY} h-10 px-4 text-sm`}>
        {t("specialists.hireButton")}
      </button>
      <p className="basis-full text-sm text-steel">{t("specialists.hireNote")}</p>
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} basis-full px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className={`${NOTICE("info")} basis-full px-3 py-2 text-sm`}>
          {done}
        </p>
      ) : null}
    </form>
  );
}
