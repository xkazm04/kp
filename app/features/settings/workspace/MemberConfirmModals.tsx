"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
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

/** Blast-radius preview for the org-level removal, computed by the API through
 *  the enforcement path (same DELETEs, executed in a transaction and rolled
 *  back — see docs/specs/2026-08-30-member-removal-blast-radius.md). */
export type RemovalImpact = {
  casualties: { users: number; credentials: number; memberships: number };
  survivors: { invitesAttributed: number };
};

/** Fetch the removal preview when the confirm opens. `error` is a distinct state
 *  on purpose: a failed count must never render as "no dependents found". */
function useRemovalImpact(userId: string | null): { impact: RemovalImpact | null; error: boolean } {
  // Keyed by the user it was fetched for — a stale result for another user
  // renders as loading, not as that user's numbers.
  const [state, setState] = useState<{ forUserId: string; impact: RemovalImpact | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // DELETE without confirm=true is the read-only preview mode of the route.
      const r = await fetch(`/api/org/members/${userId}`, { method: "DELETE" }).catch(() => null);
      const body = r && r.ok ? ((await r.json().catch(() => null)) as { preview?: boolean; impact?: RemovalImpact } | null) : null;
      if (cancelled) return;
      if (body?.preview && body.impact) setState({ forUserId: userId, impact: body.impact, error: false });
      else setState({ forUserId: userId, impact: null, error: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (!userId || !state || state.forUserId !== userId) return { impact: null, error: false };
  return { impact: state.impact, error: state.error };
}

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
          {/* The shared button recipes, not two hand-typed near-copies of them:
              these had drifted off BTN_SECONDARY/BTN_PRIMARY and so missed the
              Spark Dark sticker press every other dialog in the app has. */}
          <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm font-semibold text-steel hover:text-ink`}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
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
  const removal = useRemovalImpact(confirmingRemove ? confirmingRemove.user.id : null);

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
          {removal.error ? (
            <span className="mt-2 block text-sm font-medium text-coral">{t("confirmRemove.impactUnavailable")}</span>
          ) : removal.impact ? (
            <span className="mt-2 block text-sm">
              {t("confirmRemove.impactSeats", { seats: removal.impact.casualties.memberships })}
              {removal.impact.survivors.invitesAttributed > 0 ? (
                <> {t("confirmRemove.impactInvites", { count: removal.impact.survivors.invitesAttributed })}</>
              ) : null}
            </span>
          ) : (
            <span className="mt-2 block text-sm text-steel/70">{t("confirmRemove.impactLoading")}</span>
          )}
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
