"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Analysis } from "@/app/_lib/schemas";
import { dedupe } from "@/app/_lib/dedupe";
import { copyText } from "@/app/_lib/export-utils";

/**
 * The empty-state vignettes below paint through `var(--color-…)`, NOT the JS
 * literals in `app/_lib/brand.ts`. Those literals are the STUDIO LIGHT half of
 * each token and exist for the stylesheet-less surfaces (the OG card, the edge
 * icons) — a component inside the themed DOM that pins them into an SVG
 * fill/stroke ships a light-mode drawing into Spark Dark: the sheet rect stayed
 * cream (#fdf8ee) on a #141b24 card, and the magnifier handle — the one stroke
 * drawn straight onto the card ground rather than on a filled shape — was
 * `INK` (#17202a) on that same #141b24, i.e. 1.04:1 and simply not there.
 * Presentation attributes are parsed as CSS, so `var()` resolves per theme with
 * no `useTheme()` fork — the same trick MotionizedGlyph uses for traced glyphs.
 */
const PAPER = "var(--color-paper)";
const INK = "var(--color-ink)";
const MOSS = "var(--color-moss)";
const STEEL = "var(--color-steel)";
const LIMEWASH = "var(--color-limewash)";

/**
 * A `<details>` whose children mount only AFTER the first expand, then stay
 * mounted. A plain `<details>` keeps its collapsed content in the DOM the whole
 * time — for the two full raw-CV-text dumps in ExtractionTab that means two large
 * `<pre>` blocks are parsed and held on every report render even when nobody opens
 * them. Deferring the mount until the first toggle keeps the collapsed report lean
 * without changing the markup, classes, or the native disclosure behavior.
 */
export function LazyDetails({
  summary,
  children,
  className,
  summaryClassName,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  // Latches true on the first expand and never resets — so re-collapsing keeps the
  // (already-parsed) content mounted instead of re-mounting it on every toggle.
  const [hasOpened, setHasOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.currentTarget.open) setHasOpened(true);
      }}
    >
      <summary className={summaryClassName}>{summary}</summary>
      {hasOpened ? children : null}
    </details>
  );
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-paper p-3">
      <p className="text-meta uppercase text-steel">{label}</p>
      <p className="mt-1 font-serif text-h2 text-ink">{value}</p>
    </div>
  );
}

function EvidenceVignette() {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
    >
      <rect x="22" y="14" width="60" height="56" rx="2" fill={PAPER} stroke={INK} strokeWidth="1.5" />
      <line x1="30" y1="28" x2="68" y2="28" stroke={STEEL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 4" />
      <line x1="30" y1="40" x2="74" y2="40" stroke={STEEL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 4" />
      <line x1="30" y1="52" x2="58" y2="52" stroke={STEEL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 4" />
      <circle cx="80" cy="46" r="16" fill={LIMEWASH} stroke={INK} strokeWidth="1.75" />
      <circle cx="80" cy="46" r="10" fill={PAPER} stroke={INK} strokeWidth="0.75" opacity="0.7" />
      <line x1="92" y1="58" x2="104" y2="70" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ItemsVignette() {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
    >
      <g transform="rotate(-5 60 44)">
        <rect x="32" y="20" width="56" height="46" rx="2" fill={LIMEWASH} stroke={INK} strokeWidth="1.5" />
      </g>
      <g transform="rotate(3 64 46)">
        <rect x="36" y="22" width="56" height="46" rx="2" fill={PAPER} stroke={INK} strokeWidth="1.5" />
      </g>
      <rect x="34" y="26" width="56" height="46" rx="2" fill={PAPER} stroke={INK} strokeWidth="1.5" />
      <path d="M82 26 L90 26 L90 34 Z" fill={LIMEWASH} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="40" y1="42" x2="74" y2="42" stroke={STEEL} strokeWidth="1.25" strokeLinecap="round" strokeDasharray="2 3" />
      <line x1="40" y1="50" x2="68" y2="50" stroke={STEEL} strokeWidth="1.25" strokeLinecap="round" strokeDasharray="2 3" />
      <line x1="40" y1="58" x2="78" y2="58" stroke={STEEL} strokeWidth="1.25" strokeLinecap="round" strokeDasharray="2 3" />
      <path
        d="M18 54 Q22 38 38 36 Q40 48 32 58 Q24 60 18 54 Z"
        fill={MOSS}
        stroke={INK}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path d="M21 54 L36 39" stroke={INK} strokeWidth="0.75" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function EmptyState({
  variant,
  headline,
  hint,
}: {
  variant: "evidence" | "items";
  headline: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center px-2 py-3 text-center">
      {variant === "evidence" ? <EvidenceVignette /> : <ItemsVignette />}
      <p className="mt-3 text-base font-medium text-ink">{headline}</p>
      <p className="mt-1 text-sm leading-5 text-steel">{hint}</p>
    </div>
  );
}

/**
 * The single home for the dedupe + stable-key + empty-fallback idiom that every
 * LLM-filled string list in the report shares. dedupe.ts spells out why the
 * dedupe is mandatory (repeated lines collide as React keys and mis-bind hover
 * state); routing every list through here means no call site can silently forget
 * it or drift on key strategy. Card chrome stays with the caller — `listClassName`
 * and `itemClassName` cover the two card styles (plain rows vs `bg-paper` cards),
 * and `empty` lets each caller supply its own fallback (vignette, prose, or none).
 */
export function BulletList({
  items,
  empty = null,
  listClassName = "space-y-2",
  itemClassName = "text-base leading-6 text-ink",
}: {
  items: readonly string[];
  empty?: React.ReactNode;
  listClassName?: string;
  itemClassName?: string;
}) {
  const uniqueItems = dedupe(items);
  if (!uniqueItems.length) {
    return <>{empty}</>;
  }
  return (
    <ul className={listClassName}>
      {uniqueItems.map((item, i) => (
        <li key={`${item}-${i}`} className={itemClassName}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function InlineList({
  title,
  items,
  emptyHeadline,
  emptyHint,
}: {
  title: string;
  items: string[];
  emptyHeadline?: string;
  emptyHint?: string;
}) {
  // RES2 — localized empty-state defaults (callers can still override).
  const t = useTranslations("report");
  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className="font-serif text-h3 text-ink">{title}</h4>
      <BulletList
        items={items}
        listClassName="mt-2 space-y-2"
        empty={<EmptyState variant="evidence" headline={emptyHeadline ?? t("nothingTrace")} hint={emptyHint ?? t("nothingTraceHint")} />}
      />
    </div>
  );
}

export function ListBlock({
  icon,
  title,
  items,
  emptyHeadline,
  emptyHint,
  copyable = true,
}: {
  icon?: React.ReactNode;
  title: string;
  items: string[];
  emptyHeadline?: string;
  emptyHint?: string;
  // The report's lists (interview talking points, must-prove evidence, CV rewrite
  // suggestions) are highly reusable text an interviewer/recruiter wants to paste
  // elsewhere; a header "Copy" yields them as markdown bullets (Theme C, RES6).
  copyable?: boolean;
}) {
  const t = useTranslations("report");
  const [copied, setCopied] = useState(false);
  const unique = dedupe(items);
  const copy = async () => {
    const ok = await copyText(unique.map((i) => `- ${i}`).join("\n"));
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center gap-2">
        {icon ?? null}
        <h3 className="font-serif text-h3 text-ink">{title}</h3>
        {copyable && unique.length > 0 ? (
          <button
            type="button"
            onClick={copy}
            title={t("copyList")}
            className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-steel hover:text-coral print:hidden"
          >
            {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
            {copied ? t("copied") : t("copy")}
          </button>
        ) : null}
      </div>
      <BulletList
        items={unique}
        listClassName="mt-4 space-y-3"
        empty={<EmptyState variant="items" headline={emptyHeadline ?? t("nothingHighlight")} hint={emptyHint ?? t("nothingHighlightHint")} />}
      />
    </div>
  );
}

export function EnginePanel({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  if (!analysis.metadata) {
    return null;
  }
  // "Show your work" trust artifacts the engine already computes but the panel never
  // rendered: the grounding sources a grounded salary read was built on, and the
  // deterministic Czech-market anchor band. These separate a defensible pay number
  // from an opaque guess — a concrete differentiator, data already on the payload.
  const groundingSources = analysis.metadata.groundingSources ?? [];
  const anchorBand = analysis.metadata.deterministicEvidence?.anchorBand;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h3 text-ink">{t("engineTitle")}</h3>
      <div className="mt-3 space-y-2 text-base leading-6 text-ink">
        <p>{t("engine", { engine: analysis.metadata.analysisEngine })}</p>
        <p>{t("extractor", { extractor: analysis.metadata.textExtractor })}</p>
        {analysis.metadata.model ? <p>{t("model", { model: analysis.metadata.model })}</p> : null}
        {/* Dedupe before slicing so the cap of 3 counts distinct notes; BulletList
            re-dedupes (a no-op here) and renders nothing when the list is empty. */}
        <BulletList
          items={dedupe(analysis.metadata.parsingNotes).slice(0, 3)}
          listClassName="space-y-2"
          itemClassName=""
        />
        {anchorBand && anchorBand.length === 2 ? (
          <p className="text-sm text-steel">{t("anchorBand", { lo: anchorBand[0], hi: anchorBand[1] })}</p>
        ) : null}
        {groundingSources.length > 0 ? (
          <div>
            <p className="text-meta uppercase text-steel">{t("groundingTitle")}</p>
            <BulletList items={dedupe(groundingSources).slice(0, 5)} listClassName="mt-1 space-y-1" itemClassName="text-sm text-steel" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
