"use client";

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
  return (
    <>
      {confirmingRemove ? (
        <Modal
          title="Remove member"
          onClose={onCancelRemove}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={onCancelRemove}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                Cancel
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
                Remove member
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            Remove <span className="font-semibold text-ink">{confirmingRemove.user.name ?? confirmingRemove.user.email}</span> from the
            organization? This deletes their account and access — it can&apos;t be undone.
          </p>
        </Modal>
      ) : null}

      {confirmingRevoke ? (
        <Modal
          title="Revoke invitation"
          onClose={onCancelRevoke}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={onCancelRevoke}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                Cancel
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
                Revoke invitation
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            Revoke the invitation for <span className="font-semibold text-ink">{confirmingRevoke.email}</span>? The link already shared
            with them will stop working.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
