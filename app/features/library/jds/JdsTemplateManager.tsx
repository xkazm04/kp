"use client";

import { Modal } from "@/app/_components/Modal";
import type { TemplateData } from "@/app/features/shared/renderTemplate";
import { useTemplateManagerLogic } from "./jdsTemplateManagerLogic";
import { JdsTemplateManagerEditor } from "./JdsTemplateManagerEditor";
import { JdsTemplateManagerList } from "./JdsTemplateManagerList";

// Phase 1 follow-up — full CRUD of company JD templates. A template is markdown
// with {{placeholders}} (see render-template.ts).
export function JdTemplateManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t, templates, editing, setEditing, busy, error, confirmingId, setConfirmingId, localizeTemplateError, unknownTokens, save, remove, setDefault } =
    useTemplateManagerLogic({ onChanged });

  return (
    <Modal title={t("title")} subtitle={t("subtitle")} size="3xl" onClose={onClose}>
      {error ? <p className="mb-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
      {editing ? (
        <JdsTemplateManagerEditor
          editing={editing}
          setEditing={setEditing}
          busy={busy}
          unknownTokens={unknownTokens}
          localizeTemplateError={localizeTemplateError}
          save={save}
          cancel={() => setEditing(null)}
          t={t}
        />
      ) : (
        <JdsTemplateManagerList
          templates={templates}
          confirmingId={confirmingId}
          setConfirmingId={setConfirmingId}
          setEditing={setEditing}
          remove={remove}
          setDefault={setDefault}
          t={t}
        />
      )}
    </Modal>
  );
}

// Re-export for the composer's convenience.
export type { TemplateData };
