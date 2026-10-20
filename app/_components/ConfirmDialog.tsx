"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { BTN_PRIMARY, BTN_SECONDARY } from "./ui/recipes";

/** Shared confirmation shell for an action that needs one deliberate second step. */
export function ConfirmDialog({
  title,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  children,
}: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm font-semibold text-steel hover:text-ink`}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={confirmDisabled} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-base text-steel">{children}</p>
    </Modal>
  );
}
