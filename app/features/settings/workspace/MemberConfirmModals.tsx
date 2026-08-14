"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { memberName } from "./workspaceAdminHelpers";
import type { OrgMemberDto } from "./useWorkspaceAdmin";

// The Workspaces console's destructive-action confirms. Uses the shared themed
// Modal, not window.confirm (the one dialog the theme system can't style; see
// JobPostingModal).
//
// THREE confirms, and the wording between the first two is the point: taking
// somebody off a team is reversible (seat them again in two clicks), while
// removing them from the organization deletes their account and every membership
// with it. They used to be the same red X in the same table cell.

/** The shared shell — one Modal, one destructive footer, so the three confirms
 *  can't drift apart visually. */
function ConfirmModal({
  title,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-base text-steel">{children}</p>
    </Modal>
  );
}

export function MemberConfirmModals({
  confirmingRemoveFromWorkspace,
  onCancelRemoveFromWorkspace,
  onConfirmRemoveFromWorkspace,
  confirmingRemove,
  onCancelRemove,
  onConfirmRemove,
  confirmingRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  confirmingRemoveFromWorkspace: { member: OrgMemberDto; workspaceId: string; workspaceName: string } | null;
  onCancelRemoveFromWorkspace: () => void;
  onConfirmRemoveFromWorkspace: (target: { member: OrgMemberDto; workspaceId: string }) => void;
  confirmingRemove: OrgMemberDto | null;
  onCancelRemove: () => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
  confirmingRevoke: { token: string; email: string } | null;
  onCancelRevoke: () => void;
  onConfirmRevoke: (token: string) => void;
}) {
  const t = useTranslations("workspaceAdmin.members");
  const em = (chunks: ReactNode) => <span className="font-semibold text-ink">{chunks}</span>;

  return (
    <>
      {confirmingRemoveFromWorkspace ? (
        <ConfirmModal
          title={t("confirmRemoveFromWorkspace.title")}
          cancelLabel={t("confirmRemoveFromWorkspace.cancel")}
          confirmLabel={t("confirmRemoveFromWorkspace.confirm")}
          onCancel={onCancelRemoveFromWorkspace}
          onConfirm={() => {
            const target = confirmingRemoveFromWorkspace;
            onCancelRemoveFromWorkspace();
            onConfirmRemoveFromWorkspace({ member: target.member, workspaceId: target.workspaceId });
          }}
        >
          {t.rich("confirmRemoveFromWorkspace.body", {
            name: memberName(confirmingRemoveFromWorkspace.member),
            workspace: confirmingRemoveFromWorkspace.workspaceName,
            em,
          })}
        </ConfirmModal>
      ) : null}

      {confirmingRemove ? (
        <ConfirmModal
          title={t("confirmRemove.title")}
          cancelLabel={t("confirmRemove.cancel")}
          confirmLabel={t("confirmRemove.confirm")}
          onCancel={onCancelRemove}
          onConfirm={() => {
            const m = confirmingRemove;
            onCancelRemove();
            onConfirmRemove(m);
          }}
        >
          {t.rich("confirmRemove.body", { name: memberName(confirmingRemove), em })}
        </ConfirmModal>
      ) : null}

      {confirmingRevoke ? (
        <ConfirmModal
          title={t("confirmRevoke.title")}
          cancelLabel={t("confirmRevoke.cancel")}
          confirmLabel={t("confirmRevoke.confirm")}
          onCancel={onCancelRevoke}
          onConfirm={() => {
            const token = confirmingRevoke.token;
            onCancelRevoke();
            onConfirmRevoke(token);
          }}
        >
          {t.rich("confirmRevoke.body", { email: confirmingRevoke.email, em })}
        </ConfirmModal>
      ) : null}
    </>
  );
}
