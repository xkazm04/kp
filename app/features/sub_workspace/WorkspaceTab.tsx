"use client";

import { useState } from "react";
import { Check, Plus, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { Workspace } from "@/app/_lib/db";

// Workspace administration (P2). Lists workspaces, creates one, and switches the
// active session workspace. Honest about scope: only Analyses isolates by
// workspace today — surfaced as a banner so switching to a fresh workspace
// (empty Analyses, shared everything-else) reads as expected, not broken.
type Payload = { workspaces: Workspace[]; current: string };

export function WorkspaceTab() {
  const t = useTranslations("workspaceAdmin");
  const { data, error, reload } = useJsonFetch<Payload>("/api/workspaces");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function switchTo(id: string) {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/auth/switch-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    }).catch(() => null);
    if (r && r.ok) {
      window.location.reload(); // server components re-read the new session workspace
    } else {
      setBusy(false);
      setMsg(r?.status === 401 ? t("authRequired") : t("switchFailed"));
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    if (r && r.ok) {
      const created = (await r.json()) as { workspace?: Workspace };
      setName("");
      // Create-then-switch: land in the new workspace (falls back to a list refresh
      // if the switch is unavailable, e.g. auth off).
      if (created.workspace) await switchTo(created.workspace.id);
      else {
        reload();
        setBusy(false);
      }
    } else {
      setBusy(false);
      setMsg(t("createFailed"));
    }
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h2 className="font-serif text-display text-ink">{t("title")}</h2>
      <p className="mt-1 max-w-prose text-body text-steel">{t("intro")}</p>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{t("scopeNote")}</span>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-stone-500">{t("loadError")}</p>
      ) : !data ? (
        <p className="mt-4 text-sm text-stone-400">{t("loading")}</p>
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
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                    <Check className="h-4 w-4" aria-hidden />
                    {t("current")}
                  </span>
                ) : (
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

      <form onSubmit={create} className="mt-4 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("createPlaceholder")}
          className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-stone-400"
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
      {msg ? <p className="mt-2 text-sm text-coral">{msg}</p> : null}
    </section>
  );
}
