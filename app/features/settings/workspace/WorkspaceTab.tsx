"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { EYEBROW, INTRO, STAT, STAT_LABEL, STAT_VALUE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { countActiveMembers } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import { MemberConfirmModals } from "./MemberConfirmModals";
import { WorkspaceDetailPanel } from "./WorkspaceDetailPanel";
import { WorkspacePeoplePanel } from "./WorkspacePeoplePanel";
import { WorkspaceRail } from "./WorkspaceRail";
import { memberCounts, memberName, readError } from "./workspaceAdminHelpers";
import { useWorkspaceAdmin, type MemberTeam, type OrgMemberDto } from "./useWorkspaceAdmin";

// Settings -> Workspaces. The single console for teams AND the people on them.
//
// A workspace IS a team (docs/features/organization/README.md), and memberships are
// many-to-many: one person can work several teams of the same org at different
// roles. Member administration used to live on the Organization tab, where it
// rendered `m.teams[0]` and could only ever describe one of those seats — so this
// page merges the two and offers the same data through two lenses:
//
//   By workspace — a rail of teams, and one team's roster at a time. The view for
//                  "who is on this team, and who should be".
//   By person    — one row per colleague with every seat they hold as a chip. The
//                  view for "where does this person work, and where else should they".
//
// The deployment-level multi-workspace lock (workspace-lock.ts) gates CREATE,
// SWITCH and RENAME only. Member administration is org-scoped and stays fully
// usable while the lock is on — it is not a tenancy risk, and hiding it was never
// the point of the lock.

// Tier 3 (docs/design/loading-choreography.md): the permissions editor is a
// click-only dialog — most sessions never open it — so it gets its own chunk
// instead of riding along in the tab's entry payload.
const MemberPermissionsModal = dynamic(
  () => import("./MemberPermissionsModal").then((m) => ({ default: m.MemberPermissionsModal })),
  { loading: () => null }
);

type View = "workspace" | "person";

export function WorkspaceTab() {
  const t = useTranslations("workspaceAdmin");
  const tm = useTranslations("workspaceAdmin.members");
  const errMsg = useErrorMessage();
  const {
    workspaces,
    current,
    defaultWorkspace,
    multiWorkspace,
    members,
    invites,
    canManageMembers,
    canManageTeams,
    callerCaps,
    loading,
    error,
    reload,
  } = useWorkspaceAdmin();

  const [view, setView] = useState<View>("workspace");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ member: OrgMemberDto; team: MemberTeam } | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState<{ member: OrgMemberDto; workspaceId: string; workspaceName: string } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<OrgMemberDto | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<{ token: string; email: string } | null>(null);

  const counts = useMemo(() => memberCounts(members), [members]);
  // Selection follows the session's workspace until the user picks another, and
  // survives a reload that reorders or drops rows.
  const selected = workspaces.find((w) => w.id === selectedId) ?? workspaces.find((w) => w.id === current) ?? workspaces[0] ?? null;
  const activeCount = countActiveMembers(members);
  const workspaceName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;

  // ---- mutations -----------------------------------------------------------

  async function switchTo(id: string) {
    setBusy(true);
    const r = await fetch("/api/auth/switch-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    }).catch(() => null);
    if (r && r.ok) {
      window.location.reload(); // server components re-read the new session workspace
    } else {
      setBusy(false);
      toast.error(r?.status === 401 ? t("authRequired") : r?.status === 403 ? t("switchNotMember") : t("switchFailed"));
    }
  }

  async function createWorkspace(name: string) {
    setBusy(true);
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (r && r.ok) {
      const created = (await r.json()) as { workspace?: { id: string } };
      toast.success(t("created"));
      // Stay put and select the new team: the creator is seated as its owner, so
      // it is immediately administrable. Switching the SESSION into it is a
      // separate, explicit click — creating a team is not the same as leaving
      // the one you are working in.
      if (created.workspace) setSelectedId(created.workspace.id);
      await reload();
    } else {
      toast.error(t("createFailed"));
    }
    setBusy(false);
  }

  async function renameWorkspace(id: string, name: string) {
    setBusy(true);
    const r = await fetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (r && r.ok) {
      toast.success(t("renamed"));
      await reload();
    } else {
      toast.error(t("renameFailed"));
    }
    setBusy(false);
  }

  async function seatMember(userId: string, workspaceId: string, role: MemberRole) {
    setBusy(true);
    const r = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => null);
    if (r && r.ok) {
      toast.success(t("added", { workspace: workspaceName(workspaceId) }));
      await reload();
    } else {
      // `readError` yields the MACHINE reason (a stable `code`) — never display text.
      const err = await readError(r);
      toast.error(err === "cross_org" ? t("crossOrg") : t("addFailed"));
    }
    setBusy(false);
  }

  async function unseatMember(member: OrgMemberDto, workspaceId: string) {
    setBusy(true);
    const r = await fetch(`/api/workspaces/${workspaceId}/members/${member.user.id}`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) {
      toast.success(t("removedFromWorkspace", { name: memberName(member), workspace: workspaceName(workspaceId) }));
      await reload();
    } else {
      const err = await readError(r);
      toast.error(err === "last_owner" ? tm("lastOwner") : t("removeFromWorkspaceFailed"));
    }
    setBusy(false);
  }

  async function patchMember(userId: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (r && r.ok) {
      await reload();
      return;
    }
    const err = await readError(r);
    toast.error(err === "last_owner" ? tm("lastOwner") : tm("updateFailed"));
  }

  async function removeMember(m: OrgMemberDto) {
    const who = memberName(m);
    // confirm=true arms the destructive path; a bare DELETE is the read-only
    // blast-radius preview the confirm modal shows (see the route).
    const r = await fetch(`/api/org/members/${m.user.id}?confirm=true`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) {
      toast.success(tm("removed", { name: who }));
      await reload();
    } else {
      const err = await readError(r);
      toast.error(err === "last_owner" ? tm("lastOwner") : tm("removeFailed"));
    }
  }

  async function invite(email: string, role: MemberRole, workspaceId: string) {
    const r = await fetch("/api/org/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role, workspaceId }),
    }).catch(() => null);
    if (r && r.ok) {
      toast.success(tm("inviteCreated"));
      await reload();
    } else {
      // The route's English `error` is never rendered (docs/architecture/localization.md).
      // All three of the mint's refusals now carry a code (INVITE_EMAIL_INVALID,
      // INVITE_ROLE_ABOVE_PRIVILEGE, INVITE_ALREADY_MEMBER), so the resolver renders
      // the real reason in the reader's language and the fallback is genuinely a
      // fallback (a network drop, or the no-team server-state 409).
      const payload = r ? ((await r.json().catch(() => null)) as ApiErrorPayload | null) : null;
      toast.error(errMsg(payload, tm("inviteFailed")));
    }
  }

  async function revoke(token: string) {
    const r = await fetch(`/api/org/invites/${token}`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) {
      toast.success(tm("revoked"));
      await reload();
    } else {
      toast.error(tm("revokeFailed"));
    }
  }

  async function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tm("linkCopied"));
    } catch {
      toast.error(tm("copyFailed"));
      console.log("[invite link]", url);
    }
  }

  // ---- render --------------------------------------------------------------

  // Tier 1 (docs/design/loading-choreography.md): the header, the toggle and the
  // panel frames are chrome and need no data, so they cascade in immediately;
  // aria-busy covers the first roster fetch only.
  //
  // No container of its own: the shell already centers and pads every tab
  // (Workspace.tsx's mx-auto max-w-[108rem] px-4 py-8 wrapper).
  return (
    <section className="stagger-children space-y-6" aria-busy={loading}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-stone-200 pb-5">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <div className="flex gap-2.5">
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>{t("statWorkspaces")}</span>
            <span className={`${STAT_VALUE} text-ink`}>{workspaces.length}</span>
          </div>
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>{t("org.statActive")}</span>
            <span className={`${STAT_VALUE} text-moss`}>{activeCount}</span>
          </div>
          <div className={`${STAT} min-w-[5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>{t("org.statPending")}</span>
            <span className={`${STAT_VALUE} text-ink`}>{invites.length}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<View>
          label={t("viewAria")}
          value={view}
          onChange={setView}
          options={[
            { value: "workspace", label: t("viewByWorkspace") },
            { value: "person", label: t("viewByPerson") },
          ]}
        />
        {!multiWorkspace ? (
          <p className="flex max-w-2xl items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t("lockedNote")}</span>
          </p>
        ) : null}
      </div>

      {error && !loading ? (
        <p className="text-sm text-stone-500">{t("loadError")}</p>
      ) : view === "workspace" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <WorkspaceRail
            workspaces={workspaces}
            current={current}
            selectedId={selected?.id ?? null}
            counts={counts}
            loading={loading}
            canCreate={canManageTeams && multiWorkspace}
            busy={busy}
            onSelect={setSelectedId}
            onCreate={(name) => void createWorkspace(name)}
          />
          {selected ? (
            <WorkspaceDetailPanel
              workspace={selected}
              members={members}
              invites={invites}
              defaultWorkspaceId={defaultWorkspace ?? selected.id}
              isCurrent={selected.id === current}
              // Entering a team requires a seat in it (switch-workspace enforces
              // the same rule server-side), and the deployment lock has to be off.
              canSwitch={multiWorkspace && selected.role !== null}
              canManageMembers={canManageMembers && selected.canManage}
              canManageTeams={canManageTeams && multiWorkspace}
              loading={loading}
              error={error}
              busy={busy}
              onSwitch={(id) => void switchTo(id)}
              onRename={(id, name) => void renameWorkspace(id, name)}
              onSeatMember={(userId, workspaceId, role) => void seatMember(userId, workspaceId, role)}
              onInvite={invite}
              onPatchMember={(userId, body) => void patchMember(userId, body)}
              onEditPermissions={(member, team) => setEditing({ member, team })}
              onConfirmRemoveFromWorkspace={(member) =>
                setConfirmingLeave({ member, workspaceId: selected.id, workspaceName: workspaceName(selected.id) })
              }
              onCopyInviteLink={(token) => void copyInviteLink(token)}
              onConfirmRevoke={setConfirmingRevoke}
            />
          ) : loading ? (
            <div className="reveal-quiet min-h-[18rem] lg:col-span-2" aria-hidden />
          ) : (
            <p className="text-sm text-steel lg:col-span-2">{t("noWorkspaces")}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <WorkspacePeoplePanel
            members={members}
            workspaces={workspaces}
            loading={loading}
            error={error}
            canManageMembers={canManageMembers}
            busy={busy}
            onSeatMember={(userId, workspaceId, role) => void seatMember(userId, workspaceId, role)}
            onConfirmRemoveFromWorkspace={(member, workspaceId) =>
              setConfirmingLeave({ member, workspaceId, workspaceName: workspaceName(workspaceId) })
            }
            onPatchMember={(userId, body) => void patchMember(userId, body)}
            onConfirmRemove={setConfirmingRemove}
          />
        </div>
      )}

      <MemberConfirmModals
        confirmingRemoveFromWorkspace={confirmingLeave}
        onCancelRemoveFromWorkspace={() => setConfirmingLeave(null)}
        onConfirmRemoveFromWorkspace={({ member, workspaceId }) => void unseatMember(member, workspaceId)}
        confirmingRemove={confirmingRemove}
        onCancelRemove={() => setConfirmingRemove(null)}
        onConfirmRemove={(m) => void removeMember(m)}
        confirmingRevoke={confirmingRevoke}
        onCancelRevoke={() => setConfirmingRevoke(null)}
        onConfirmRevoke={(token) => void revoke(token)}
      />

      {editing ? (
        <MemberPermissionsModal
          member={editing.member}
          team={editing.team}
          callerCaps={callerCaps}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </section>
  );
}
