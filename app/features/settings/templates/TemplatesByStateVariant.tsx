"use client";

// Variant B — "By state": the board. One column per pipeline state, each holding
// the templates written for it, and a card opens the editor in a modal.
//
// The proposition being tested: the question a recruiter actually arrives with is
// "what do we send when someone reaches Interview?", which is a question about a
// COLUMN, not about a library. The board's gaps are the point — an empty column
// is a state nobody has written a message for yet, and it says so.

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { TEMPLATE_KINDS, UNSORTED, type TemplateBucket } from "./templateKinds";
import { ScopeBadge, useBucketLabel } from "./TemplatesShared";
import { TemplatesEditorPanel } from "./TemplatesEditorPanel";
import { draftOf, emptyDraft, type MessageDraft, type TemplatesStore } from "./useMessageTemplates";

export function TemplatesByStateVariant({ store }: { store: TemplatesStore }) {
  const t = useTranslations("templates.board");
  const bucketLabel = useBucketLabel();
  const [draft, setDraft] = useState<MessageDraft | null>(null);

  const columns = useMemo(() => {
    const all = store.templates ?? [];
    // The five prototype states, always shown — an empty column is information.
    // `unsorted` joins them only when it holds something: a template whose name
    // carries no state prefix is real data and must not be swallowed, but an
    // empty sixth column would advertise a bucket that is an artefact of the
    // naming convention rather than a stage of anyone's pipeline.
    const buckets: TemplateBucket[] = [...TEMPLATE_KINDS];
    if (all.some((tpl) => tpl.bucket === UNSORTED)) buckets.push(UNSORTED);
    return buckets.map((bucket) => ({ bucket, items: all.filter((tpl) => tpl.bucket === bucket) }));
  }, [store.templates]);

  const commit = async () => {
    if (!draft) return;
    if (await store.save(draft)) setDraft(null);
  };

  const destroy = async () => {
    if (!draft?.id) return;
    if (await store.remove(draft.id)) setDraft(null);
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {columns.map((col) => (
          <section key={col.bucket} className={`${PANEL} flex flex-col gap-2 p-4`}>
            <header className="flex items-baseline justify-between gap-2">
              <h3 className={META_LABEL}>{bucketLabel(col.bucket)}</h3>
              <span className="text-micro tabular-nums text-steel">{col.items.length}</span>
            </header>

            {col.items.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setDraft(draftOf(tpl))}
                className="focus-ring cursor-pointer rounded-md border border-stone-200 bg-white p-3 text-left transition-colors hover:border-coral/40"
              >
                <span className="block truncate text-sm font-semibold text-ink">{tpl.title}</span>
                <span className="mt-1 block line-clamp-2 text-micro text-steel">{tpl.body}</span>
                <span className="mt-2 block">
                  <ScopeBadge scope={tpl.scope} isDefault={tpl.isDefault} />
                </span>
              </button>
            ))}

            {col.items.length === 0 ? <p className="text-sm text-steel">{t("emptyColumn")}</p> : null}

            <button
              type="button"
              onClick={() => setDraft(emptyDraft(col.bucket))}
              className="focus-ring mt-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-stone-300 px-3 py-2 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-ink"
            >
              <Plus size={14} aria-hidden />
              {t("addHere")}
            </button>
          </section>
        ))}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? t("editTitle") : t("newTitle")}
          subtitle={bucketLabel(draft.bucket)}
          onClose={() => setDraft(null)}
          size="3xl"
        >
          <TemplatesEditorPanel
            draft={draft}
            setDraft={setDraft}
            busy={store.busy}
            onSave={() => void commit()}
            onCancel={() => setDraft(null)}
            onDelete={draft.id ? () => void destroy() : undefined}
          />
        </Modal>
      ) : null}
    </>
  );
}
