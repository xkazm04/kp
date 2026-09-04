"use client";

import { useState } from "react";
import { Check, Lock, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { WorkspaceDto } from "./useWorkspaceAdmin";

// The Workspaces console — left column: every team in the org, the one you are
// signed into, and the create form. Selecting a row is NOT switching: reading and
// administering a team's roster happens from wherever you are signed in, and
// Switch (in the detail panel) is the separate, session-re-minting act.
export function WorkspaceRail({
  workspaces,
  current,
  selectedId,
  counts,
  loading,
  canCreate,
  busy,
  onSelect,
  onCreate,
}: {
  workspaces: WorkspaceDto[];
  current: string | null;
  selectedId: string | null;
  counts: Map<string, number>;
  loading: boolean;
  canCreate: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const t = useTranslations("workspaceAdmin");
  const [name, setName] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setName("");
    onCreate(clean);
  }

  return (
    <div className={`${PANEL} h-fit overflow-hidden lg:col-span-1`}>
      <p className={`${META_LABEL} border-b border-stone-200 px-4 py-3`}>{t("railTitle")}</p>

      {/* Tier 2: hold the rail's height while the first fetch is in flight, so a
          warm response never flashes an empty list. */}
      {loading ? (
        <div className="reveal-quiet min-h-[10rem]" aria-hidden />
      ) : (
        <ul className="divide-y divide-stone-100">
          {workspaces.map((w) => {
            const isSelected = w.id === selectedId;
            const isCurrent = w.id === current;
            const count = counts.get(w.id) ?? w.memberCount;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => onSelect(w.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`focus-ring flex w-full items-center gap-2 px-4 py-3 text-left transition-colors ${
                    isSelected ? "bg-stone-50" : "hover:bg-stone-50"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${isSelected ? "font-semibold text-ink" : "text-ink"}`}>{w.name ?? w.id}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-micro text-steel">
                      <Users size={12} aria-hidden />
                      {t("memberCount", { count })}
                    </span>
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-micro font-medium text-moss">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {t("current")}
                    </span>
                  ) : !w.canManage ? (
                    <Lock size={13} className="shrink-0 text-stone-300" aria-label={t("readOnlyWorkspace")} />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {canCreate ? (
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("createPlaceholder")}
            sizeVariant="sm"
            aria-label={t("createPlaceholder")}
            className="min-w-0 flex-1"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !name.trim()} className={`${BTN_PRIMARY} h-9 shrink-0 px-3`}>
            <Plus size={15} aria-hidden />
            <span className="sr-only">{t("create")}</span>
          </button>
        </form>
      ) : null}
    </div>
  );
}
