"use client";

import type { ReactNode } from "react";
import { Modal } from "../Modal";
import "./kit.css";
import "./menu.css";

/**
 * @catalog A kit dialog: the app's Modal (focus trap, Escape, scrim, one close) with a kit body and kit actions. The Modal portals to <body>, outside any KitSurface, so the body and the action row re-open the kit's variables themselves.
 */
export function KitDialog({ title, subtitle, onClose, actions, size = "md", children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Kit Buttons, right-aligned in the dialog's foot. */
  actions?: ReactNode;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      size={size}
      footer={actions ? <div className="k-kit k-dialog__acts" data-density="compact">{actions}</div> : undefined}
    >
      <div className="k-kit k-dialog" data-density="compact" data-part="dialog">
        {children}
      </div>
    </Modal>
  );
}
