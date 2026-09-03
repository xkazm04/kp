"use client";

import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { TemplateData } from "@/app/features/shared/renderTemplate";
import { useTemplateManagerLogic } from "./jdsTemplateManagerLogic";
import { JdsTemplateManagerEditor } from "./JdsTemplateManagerEditor";
import { JdsTemplateManagerList } from "./JdsTemplateManagerList";

// Phase 1 follow-up — full CRUD of company JD templates. A template is markdown
// with {{placeholders}} (see render-template.ts).
//
// Closing the modal goes through the logic's exit guard: a half-written rich-text
// body used to be discarded silently by the header X / Escape / backdrop, exactly
// the class of loss wave 8 fixed for the JD builder.
export function JdTemplateManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const m = useTemplateManagerLogic({ onChanged, onClose });

  return (
    <Modal title={m.t("title")} subtitle={m.t("subtitle")} size="3xl" onClose={() => m.requestExit("close")}>
      {m.error ? (
        <div className={`${NOTICE("critical")} mb-3 space-y-1.5 px-3 py-2 text-sm`}>
          <p role="alert">{m.error}</p>
          {m.conflict ? (
            <button type="button" onClick={m.reloadConflict} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm font-semibold text-coral`}>
              {m.t("reloadLatest")}
            </button>
          ) : null}
        </div>
      ) : null}
      {m.editing ? (
        <JdsTemplateManagerEditor
          editing={m.editing}
          setEditing={m.setEditing}
          busy={m.busy}
          unknownTokens={m.unknownTokens}
          localizeTemplateError={m.localizeTemplateError}
          save={m.save}
          cancel={() => m.requestExit("cancel")}
          t={m.t}
        />
      ) : (
        <JdsTemplateManagerList
          templates={m.templates}
          loading={m.loading}
          loadFailed={m.loadFailed}
          reload={() => void m.reload()}
          confirmingId={m.confirmingId}
          setConfirmingId={m.setConfirmingId}
          beginEdit={m.beginEdit}
          remove={m.remove}
          setDefault={m.setDefault}
          t={m.t}
        />
      )}
      {/* Stacked over the manager — the shared Modal's dialog stack keeps Escape
          and the focus trap on THIS one while it is open (the ledger detail
          modal's idiom, same copy shape). */}
      {m.pendingExit ? (
        <Modal
          title={m.t("unsavedTitle")}
          onClose={m.keepEditing}
          size="md"
          footer={
            <>
              <button type="button" onClick={m.keepEditing} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                {m.t("unsavedKeep")}
              </button>
              <button type="button" onClick={m.discardAndExit} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
                {m.t("unsavedDiscard")}
              </button>
            </>
          }
        >
          <p className="text-sm text-steel">{m.t("unsavedBody")}</p>
        </Modal>
      ) : null}
    </Modal>
  );
}

// Re-export for the composer's convenience.
export type { TemplateData };
