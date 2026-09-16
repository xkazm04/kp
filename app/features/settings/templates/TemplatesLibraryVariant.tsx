"use client";

// Variant A — "Library": the two-pane manager. A filterable list of every
// template the team can see on the left, grouped by the pipeline state its name
// declares; the editor for the selected one on the right.
//
// The proposition being tested: a recruiter maintaining a message library thinks
// in terms of "all my templates", and wants one place that shows the whole set
// with its scope tiers visible at a glance.

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { TEMPLATE_BUCKETS, type TemplateBucket } from "./templateKinds";
import { ScopeBadge, useBucketLabel } from "./TemplatesShared";
import { TemplatesEditorPanel } from "./TemplatesEditorPanel";
import { draftOf, emptyDraft, type MessageDraft, type MessageTemplate, type TemplatesStore } from "./useMessageTemplates";

export function TemplatesLibraryVariant({ store }: { store: TemplatesStore }) {
  const t = useTranslations("templates.library");
  const bucketLabel = useBucketLabel();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<MessageDraft | null>(null);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = (store.templates ?? []).filter(
      (tpl) => !q || tpl.title.toLowerCase().includes(q) || tpl.body.toLowerCase().includes(q)
    );
    return TEMPLATE_BUCKETS.map((bucket) => ({ bucket, items: hits.filter((h) => h.bucket === bucket) })).filter(
      (g) => g.items.length > 0
    );
  }, [query, store.templates]);

  const open = (tpl: MessageTemplate) => setDraft(draftOf(tpl));

  const commit = async () => {
    if (!draft) return;
    if (await store.save(draft)) setDraft(null);
  };

  const destroy = async () => {
    if (!draft?.id) return;
    if (await store.remove(draft.id)) setDraft(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className={`${PANEL} flex min-h-0 flex-col gap-3 p-4`}>
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          sizeVariant="sm"
        />
        <button
          type="button"
          onClick={() => setDraft(emptyDraft())}
          className={`${BTN_PRIMARY} h-9 cursor-pointer justify-center px-3 text-sm`}
        >
          <Plus size={15} aria-hidden />
          {t("new")}
        </button>

        {store.templates === null && !store.loadFailed ? <p className="text-sm text-steel">{t("loading")}</p> : null}
        {grouped.length === 0 && store.templates !== null ? <p className="text-sm text-steel">{t("empty")}</p> : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {grouped.map((group) => (
            <section key={group.bucket} className="space-y-1">
              <h3 className={META_LABEL}>{bucketLabel(group.bucket as TemplateBucket)}</h3>
              {group.items.map((tpl) => {
                const selected = draft?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => open(tpl)}
                    aria-current={selected || undefined}
                    className={`focus-ring block w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                      selected ? "border-coral/40 bg-coral/10" : "border-stone-200 bg-white hover:border-coral/40"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold text-ink">{tpl.title}</span>
                    <span className="mt-1 block">
                      <ScopeBadge scope={tpl.scope} isDefault={tpl.isDefault} />
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      <div className={`${PANEL} p-5`}>
        {draft ? (
          <TemplatesEditorPanel
            draft={draft}
            setDraft={setDraft}
            busy={store.busy}
            onSave={() => void commit()}
            onCancel={() => setDraft(null)}
            onDelete={draft.id ? () => void destroy() : undefined}
          />
        ) : (
          <p className="text-sm text-steel">{t("pickOne")}</p>
        )}
      </div>
    </div>
  );
}
