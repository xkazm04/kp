"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import type { OrgMemberDto } from "./useOrganizationMembers";

// Organization console — the two destructive-action confirms (remove member /
// revoke invite). Split out of OrganizationConsole.tsx; uses the shared themed
// Modal, not window.confirm (see JobPostingModal) since removing a member
// deletes their account and revoking kills an already-shared invite link.
export function OrganizationMemberConfirmModals({
  confirmingRemove,
  onCancelRemove,
  onConfirmRemove,
  confirmingRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  confirmingRemove: OrgMemberDto | null;
  onCancelRemove: () => void;
  onConfirmRemove: (member: OrgMemberDto) => void;
  confirmingRevoke: { token: string; email: string } | null;
  onCancelRevoke: () => void;
  onConfirmRevoke: (token: string) => void;
}) {
  const t = useTranslations("workspaceAdmin.members");
  return (
    <>
      {confirmingRemove ? (
        <Modal
          title={t("confirmRemove.title")}
          onClose={onCancelRemove}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={onCancelRemove}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                {t("confirmRemove.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const m = confirmingRemove;
                  onCancelRemove();
                  onConfirmRemove(m);
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {t("confirmRemove.confirm")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            {t.rich("confirmRemove.body", {
              name: confirmingRemove.user.name ?? confirmingRemove.user.email,
              em: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
            })}
          </p>
        </Modal>
      ) : null}

      {confirmingRevoke ? (
        <Modal
          title={t("confirmRevoke.title")}
          onClose={onCancelRevoke}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={onCancelRevoke}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                {t("confirmRevoke.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const token = confirmingRevoke.token;
                  onCancelRevoke();
                  onConfirmRevoke(token);
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {t("confirmRevoke.confirm")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            {t.rich("confirmRevoke.body", {
              email: confirmingRevoke.email,
              em: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
            })}
          </p>
        </Modal>
      ) : null}
    </>
  );
}
