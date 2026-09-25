"use client";

import { useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { safeLinkHref } from "@/app/_components/markdown-html";
import { BTN_SECONDARY, CHIP, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigBrief, GigBriefLink } from "@/app/_lib/gigs/types";
import { briefHeadingResolver, type AfterWrite } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { DifficultyGlyph } from "./GigsMarks";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// A gig's research brief (docs/features/gigs/README.md "Research"), read the way the
// registry's long-form-reading-surface subject asks:
//   - the facts first (category, the categorized title, difficulty with its reason,
//     effort, the challenges), each absence stated ("not rated", "not estimated");
//   - the Markdown body at a reading measure (~70ch, 16px+), rendered by the safe
//     renderer (React elements, safe hrefs, links in a new tab, noopener);
//   - heading ids are the ones the SERVER minted with one assigner (`brief.sections`,
//     anchor-id-single-assigner + server-parsed-once-reused) - nothing is re-slugged
//     here - and a contents list built from the same `sections` when there are 3+;
//   - a contents link scrolls its heading clear of the chrome (scroll-margin) and moves
//     focus to it (a focus destination, never a tab stop);
//   - "Sources read" as a list whose status is words, not colour.
// No reading time is shown: it would be a claim about the reader the method cannot make.

/** The fixed section kp's brief closes with; the structured list below replaces its prose. */
const SOURCES_SECTION_ID = "sources-read";

/** Scroll margin for an addressed heading: kp's workspace has no sticky top chrome on
 *  any breakpoint (the rail is a side column; the phone bar scrolls away), so the margin
 *  is breathing room above the heading, the same 1.5rem the page's other anchors use. */
const ANCHOR = "scroll-mt-6";

export function GigBriefPanel({ gig, onChanged }: { gig: Gig; onChanged: AfterWrite }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer of "Research again", shown in place until the list re-read carries it.
  const [fresh, setFresh] = useState<{ gigId: string; brief: GigBrief } | null>(null);
  const brief = fresh && fresh.gigId === gig.id && (!gig.brief || gig.brief.createdAt < fresh.brief.createdAt) ? fresh.brief : gig.brief;

  async function research() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}/research`, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("brief.failed")));
      return;
    }
    const next = (res.body?.gig as Gig | undefined)?.brief ?? null;
    if (next) setFresh({ gigId: gig.id, brief: next });
    await onChanged(null);
  }

  const button = (
    <button type="button" disabled={busy} onClick={() => void research()} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
      <RefreshCw size={14} aria-hidden className={busy ? "animate-spin motion-reduce:animate-none" : undefined} /> {brief ? t("brief.researchAgain") : t("brief.research")}
    </button>
  );
  const status = (
    <>
      {busy ? (
        <p role="status" className="text-sm text-steel">
          {t("brief.researching")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
    </>
  );

  if (!brief) {
    return (
      <section aria-labelledby={`brief-${gig.id}`} className="space-y-2">
        <h3 id={`brief-${gig.id}`} className={META_LABEL}>
          {t("brief.title")}
        </h3>
        <div className={`${PANEL_SUNKEN} space-y-2 px-4 py-3`}>
          <p className="font-semibold text-ink">{t("brief.notYet")}</p>
          <p className="max-w-[70ch] text-sm text-steel">{t("brief.notYetBody")}</p>
          {button}
        </div>
        {status}
      </section>
    );
  }

  const fetched = brief.links.filter((l) => l.status === "fetched").length;
  const reasonKey = brief.fallbackReason?.startsWith("llm_error") ? "llm_error" : brief.fallbackReason;
  const reason = reasonKey && t.has(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) ? t(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) : (brief.fallbackReason ?? "").replace(/_/g, " ");
  const sourcesSection = brief.sections.find((s) => s.id === SOURCES_SECTION_ID) ?? null;
  // The body up to the server-declared "Sources read" heading; the structured list below
  // takes its place. Located by the section the server declared, never re-parsed; when the
  // line is not where the section says, the body is rendered whole and the list below
  // carries no id (no address is ever issued twice).
  const cut = sourcesSection ? brief.markdown.indexOf(`\n## ${sourcesSection.text}\n`) : -1;
  const cutAtStart = sourcesSection && brief.markdown.startsWith(`## ${sourcesSection.text}\n`);
  const body = cut >= 0 ? brief.markdown.slice(0, cut) : cutAtStart ? "" : brief.markdown;
  const listId = cut >= 0 || cutAtStart ? SOURCES_SECTION_ID : undefined;
  const headingId = briefHeadingResolver(brief.sections);

  return (
    <section aria-labelledby={`brief-${gig.id}`} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h3 id={`brief-${gig.id}`} className={META_LABEL}>
            {t("brief.title")}
          </h3>
          <p className="text-sm text-steel">
            {brief.source === "llm" ? t("brief.byModel", { count: fetched }) : t("brief.byKp", { count: fetched, reason })}
            {" · "}
            {t("brief.researchedAt", { date: fmt.dateTime(brief.createdAt) })}
          </p>
        </div>
        {button}
      </div>
      {status}

      <div className="space-y-3">
        <span className={`${CHIP} text-sm`}>{brief.category}</span>
        <p className="max-w-[70ch] font-serif text-h3 text-ink">{brief.title}</p>
        <dl className="grid max-w-[70ch] gap-x-4 gap-y-2 text-base sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-sm text-steel sm:pt-0.5">{t("brief.difficulty")}</dt>
          <dd className="text-ink">
            <span className="inline-flex items-center gap-2 font-semibold">
              <DifficultyGlyph difficulty={brief.difficulty} className="h-3.5 w-5" />
              {brief.difficulty === "unrated" ? <Absent>{t("brief.level.unrated")}</Absent> : t(`brief.level.${brief.difficulty}` as Parameters<typeof t>[0])}
            </span>
            {brief.difficultyReason ? <span className="block text-steel">{brief.difficultyReason}</span> : brief.difficulty === "unrated" ? <span className="block text-steel">{t("brief.unratedWhy")}</span> : null}
          </dd>
          <dt className="text-sm text-steel sm:pt-0.5">{t("brief.effort")}</dt>
          <dd className="text-ink">
            {brief.effort ? (
              <>
                <span className="font-semibold nums">{t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours })}</span>
                {brief.effort.note ? <span className="block text-steel">{brief.effort.note}</span> : null}
              </>
            ) : (
              <Absent>{t("brief.effortNone")}</Absent>
            )}
          </dd>
          <dt className="text-sm text-steel sm:pt-0.5">{t("brief.challenges")}</dt>
          <dd className="text-ink">
            {brief.challenges.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {brief.challenges.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <Absent>{t("brief.challengesNone")}</Absent>
            )}
          </dd>
        </dl>
      </div>

      {brief.sections.length >= 3 ? (
        <nav aria-label={t("brief.contents")} className="max-w-[70ch] border-l-2 border-stone-200 pl-3">
          <p className={META_LABEL}>{t("brief.contentsTitle")}</p>
          <ol className="mt-1 space-y-0.5 text-sm">
            {brief.sections.map((s) => (
              <li key={s.id} className={s.level === 3 ? "pl-4" : undefined}>
                <a href={`#${s.id}`} onClick={(e) => jumpTo(e, s.id)} className="focus-ring font-medium text-coral underline decoration-coral/30 underline-offset-2 hover:decoration-coral">
                  {s.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {body.trim() ? <Markdown content={body} headingId={headingId} className="max-w-[70ch] text-base [&_[id]]:scroll-mt-6" /> : null}

      <div className="max-w-[70ch]">
        <h3 id={listId} tabIndex={listId ? -1 : undefined} className={`font-serif text-h3 text-ink ${ANCHOR}`}>
          {sourcesSection?.text ?? t("brief.sourcesRead")}
        </h3>
        {brief.links.length === 0 ? (
          <p className="mt-2 text-base text-steel">{t("brief.linksNone")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-200 border-y border-stone-200">
            {brief.links.map((l, i) => (
              <LinkRow key={`${l.url}-${i}`} link={l} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** A contents link: scroll the heading in (its scroll-margin keeps it clear of the chrome)
 *  and move focus onto it, so the keyboard reader continues from there. */
function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

/** One link the listing named: what happened to it, in words. A link kp did not open
 *  (blocked, skipped, failed) is shown as text, never as something to click. */
function LinkRow({ link }: { link: GigBriefLink }) {
  const t = useTranslations("gigs");
  const flagged = link.status === "fetched" && link.reason?.startsWith("suspect:");
  const href = link.status === "fetched" ? safeLinkHref(link.url) : null;
  const label = link.title?.trim() || link.url;
  return (
    <li className="grid gap-x-3 gap-y-0.5 py-2 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <span className={`font-semibold ${link.status === "fetched" && !flagged ? "text-ink" : "text-steel"}`}>
        {t(`brief.linkStatus.${link.status}` as Parameters<typeof t>[0])}
        {flagged ? <span className="block font-normal text-coral">{t("brief.linkFlagged")}</span> : null}
      </span>
      <span className="min-w-0">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex max-w-full items-baseline gap-1 break-words font-medium text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral">
            <span className="min-w-0 break-words">{label}</span> <ExternalLink size={12} aria-hidden className="shrink-0" />
          </a>
        ) : (
          <code className="break-all font-mono text-sm text-ink">{link.url}</code>
        )}
        <span className="block text-steel">
          {link.reason && !flagged ? <span className="font-mono">{link.reason}</span> : null}
          {link.reason && !flagged && link.chars !== null ? " · " : null}
          {link.chars !== null ? <span className="nums">{t("brief.linkChars", { count: link.chars })}</span> : null}
        </span>
      </span>
    </li>
  );
}
