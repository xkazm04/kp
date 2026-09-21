"use client";

// The pieces all three prototype variants share: how a bucket is named, how a
// scope is badged, the clickable placeholder chips, and the live preview pane.
// Written once here so the variants differ in LAYOUT — which is the thing being
// prototyped — rather than in vocabulary.

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { Select } from "@/app/_components/Select";
import { CHIP_QUIET, PANEL_SUNKEN, META_LABEL } from "@/app/_components/ui/recipes";
import {
  SUPPORTED_PLACEHOLDER_LIST,
  TEMPLATE_LOCALIZED_TOKENS,
  TEMPLATE_PLACEHOLDERS,
} from "@/app/features/shared/renderTemplate";
import { TEMPLATE_BUCKETS, type TemplateBucket } from "./templateKinds";
import { useTemplatePreview } from "./templatesRender";

/** `(bucket) => the reader's name for it`. */
export function useBucketLabel(): (bucket: TemplateBucket) => string {
  const t = useTranslations("templates.kind");
  return useMemo(() => (bucket: TemplateBucket) => t(bucket), [t]);
}

/** The bucket picker, as the shared Select primitive. */
export function BucketSelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: TemplateBucket;
  onChange: (bucket: TemplateBucket) => void;
  ariaLabel: string;
  className?: string;
}) {
  const label = useBucketLabel();
  return (
    <Select
      value={value}
      onChange={(v) => onChange(v as TemplateBucket)}
      options={TEMPLATE_BUCKETS.map((b) => ({ value: b, label: label(b) }))}
      ariaLabel={ariaLabel}
      sizeVariant="sm"
      className={className}
    />
  );
}

/** Which tier a template sits in — the org-shared curated library, or this
 *  team's own draft — plus the org default marker when it holds it. */
export function ScopeBadge({ scope, isDefault }: { scope: "org" | "team"; isDefault?: boolean }) {
  const t = useTranslations("templates.scope");
  return (
    <span className="inline-flex items-center gap-1">
      <span className={CHIP_QUIET}>{scope === "org" ? t("org") : t("team")}</span>
      {isDefault ? <span className={`${CHIP_QUIET} text-coral`}>{t("default")}</span> : null}
    </span>
  );
}

/** Every token the renderer substitutes, as buttons that insert it at the
 *  caret. The set is imported, never re-listed: a token added to the renderer
 *  appears here automatically, and the API's unknown-token guard (which BLOCKS a
 *  body carrying anything else) can never disagree with what this offers. */
export function PlaceholderChips({ onInsert }: { onInsert: (token: string) => void }) {
  const t = useTranslations("templates.editor");
  const chip = (token: string, tone: string) => (
    <button
      key={token}
      type="button"
      onClick={() => onInsert(`{{${token}}}`)}
      title={t("insertToken", { token })}
      className={`focus-ring cursor-pointer rounded border border-stone-200 bg-white px-1.5 py-0.5 font-mono text-sm ${tone} transition-colors hover:border-coral/40`}
    >
      {`{{${token}}}`}
    </button>
  );
  return (
    <div className="space-y-2">
      <p className={META_LABEL}>{t("placeholders")}</p>
      <div className="flex flex-wrap gap-1">{TEMPLATE_PLACEHOLDERS.map((p) => chip(p, "text-coral"))}</div>
      <p className={META_LABEL}>{t("localizedTokens")}</p>
      <div className="flex flex-wrap gap-1">{TEMPLATE_LOCALIZED_TOKENS.map((p) => chip(p, "text-moss"))}</div>
      <p className="text-micro text-steel">{t("tokenHint", { supported: SUPPORTED_PLACEHOLDER_LIST })}</p>
    </div>
  );
}

/** The body as a recruiter's message, rendered against sample data. */
export function PreviewPane({ body, className = "" }: { body: string; className?: string }) {
  const t = useTranslations("templates.editor");
  const render = useTemplatePreview();
  const rendered = body.trim() ? render(body) : "";
  return (
    <div className={`${PANEL_SUNKEN} min-h-0 overflow-y-auto p-4 ${className}`}>
      <p className={`${META_LABEL} mb-2`}>{t("preview")}</p>
      {rendered ? <Markdown content={rendered} /> : <p className="text-sm text-steel">{t("previewEmpty")}</p>}
    </div>
  );
}
