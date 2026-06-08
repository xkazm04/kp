"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Analysis } from "@/app/_lib/schemas";
import { dedupe } from "@/app/_lib/dedupe";
import { copyText } from "@/app/_lib/export-utils";
import { PAPER, INK, MOSS, STEEL, LIMEWASH } from "@/app/_lib/brand";

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
  emptyHeadline = "Nothing to trace yet",
  emptyHint = "Add more detail to your CV so we can surface evidence here.",
}: {
  title: string;
  items: string[];
  emptyHeadline?: string;
  emptyHint?: string;
}) {
  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className="font-serif text-h3 text-ink">{title}</h4>
      <BulletList
        items={items}
        listClassName="mt-2 space-y-2"
        empty={<EmptyState variant="evidence" headline={emptyHeadline} hint={emptyHint} />}
      />
    </div>
  );
}

export function ListBlock({
  icon,
  title,
  items,
  emptyHeadline = "Nothing to highlight yet",
  emptyHint = "Refine your CV to surface items in this list.",
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
            title="Copy this list"
            className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-steel hover:text-coral print:hidden"
          >
            {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <BulletList
        items={unique}
        listClassName="mt-4 space-y-3"
        empty={<EmptyState variant="items" headline={emptyHeadline} hint={emptyHint} />}
      />
    </div>
  );
}

export function EnginePanel({ analysis }: { analysis: Analysis }) {
  if (!analysis.metadata) {
    return null;
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h3 text-ink">Analysis Engine</h3>
      <div className="mt-3 space-y-2 text-base leading-6 text-ink">
        <p>Engine: {analysis.metadata.analysisEngine}</p>
        <p>Extractor: {analysis.metadata.textExtractor}</p>
        {analysis.metadata.model ? <p>Model: {analysis.metadata.model}</p> : null}
        {/* Dedupe before slicing so the cap of 3 counts distinct notes; BulletList
            re-dedupes (a no-op here) and renders nothing when the list is empty. */}
        <BulletList
          items={dedupe(analysis.metadata.parsingNotes).slice(0, 3)}
          listClassName="space-y-2"
          itemClassName=""
        />
      </div>
    </div>
  );
}
