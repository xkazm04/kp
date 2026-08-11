"use client";

import { useState } from "react";
import { Check, Plus, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";
import { INTRO } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { Workspace } from "@/app/_lib/db/workspaces";

// Workspace administration (P2). Lists workspaces, creates one, and switches the
// active session workspace. Tenancy is single-tenant-locked until per-workspace
// data isolation lands (workspace-lock.ts): when `multiWorkspace` is false the
// create form and switch buttons are hidden and the banner explains why, so the
// UI no longer offers an action that would expose another tenant's data.
type Payload = { workspaces: Workspace[]; current: string; multiWorkspace: boolean };

export function WorkspaceTab() {
  const t = useTranslations("workspaceAdmin");
  const { data, error, reload } = useJsonFetch<Payload>("/api/workspaces");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Default to locked until the payload says otherwise, so the create/switch UI is
  // never shown speculatively while loading.
  const locked = !data?.multiWorkspace;

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
      toast.error(r?.status === 401 ? t("authRequired") : t("switchFailed"));
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    if (r && r.ok) {
      const created = (await r.json()) as { workspace?: Workspace };
      setName("");
      toast.success(t("created"));
      // Create-then-switch: land in the new workspace (falls back to a list refresh
      // if the switch is unavailable, e.g. auth off).
      if (created.workspace) await switchTo(created.workspace.id);
      else {
        reload();
        setBusy(false);
      }
    } else {
      setBusy(false);
      toast.error(t("createFailed"));
    }
  }

  return (
    // Tier 1 (docs/design/loading-choreography.md): header, the lock/scope note and the
    // list/error/placeholder region are the section's direct children, so they
    // cascade in together; the header and note need no data and never wait on the
    // fetch. aria-busy covers the first load only (mirrors useJsonFetch's own
    // one-way data===null -> data!==null transition on a normal first mount).
    //
    // No container of its own: the shell already centers and pads every tab
    // (Workspace.tsx's mx-auto max-w-[108rem] px-4 py-8 wrapper). A second
    // mx-auto/max-w/px here is what made this tab render narrower and inset
    // relative to every other Settings tab.
    <section className="stagger-children" aria-busy={!data && !error}>
      <h2 className="font-serif text-display text-ink">{t("title")}</h2>
      <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>

      <div className="mt-4 flex max-w-2xl items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{locked ? t("lockedNote") : t("scopeNote")}</span>
      </div>

      {/* Tier 2: the workspace list fetch is in flight and there is nothing to show
          yet — hold the list's height and stay invisible for 150ms so a warm
          response never flashes anything. (Was a bare "Loading…" line — the tab's
          whole first state was text, the anti-pattern the choreography spec calls
          out by name.) */}
      {error ? (
        <p className="mt-4 text-sm text-stone-500">{t("loadError")}</p>
      ) : !data ? (
        <div className="mt-5 reveal-quiet min-h-[12rem]" aria-hidden />
      ) : (
        <ul className="mt-5 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
          {data.workspaces.map((w) => {
            const isCurrent = w.id === data.current;
            return (
              <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <span className="text-ink">{w.name ?? w.id}</span>
                  <span className="ml-2 font-mono text-xs text-stone-400">{w.id}</span>
                </div>
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1 text-sm text-green-700">
                    <Check className="h-4 w-4" aria-hidden />
                    {t("current")}
                  </span>
                ) : locked ? null : (
                  <button
                    type="button"
                    onClick={() => switchTo(w.id)}
                    disabled={busy}
                    className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-ink hover:bg-stone-50 disabled:opacity-60"
                  >
                    {t("switch")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {locked ? null : (
        <form onSubmit={create} className="mt-4 flex items-center gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("createPlaceholder")}
            sizeVariant="sm"
            className="flex-1"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("create")}
          </button>
        </form>
      )}
    </section>
  );
}
