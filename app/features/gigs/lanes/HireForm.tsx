"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_ARENAS, type GigArena } from "@/app/_lib/gigs/types";
import { sendJson } from "../data/useGigsData";
import { useGigsFormat } from "../data/useGigsFormat";

// Hire a specialist (GigsLanes.tsx): an arena and a niche, POST /api/gigs/specialists.
// The route answers `reused` when that niche is already hired.

export function HireForm({ initialArena, onHired, onClose }: { initialArena: GigArena; onHired: () => Promise<unknown>; onClose: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [arena, setArena] = useState<GigArena>(initialArena);
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function hire() {
    if (busy) return;
    if (!niche.trim()) {
      setError(t("specialists.nicheRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson("/api/gigs/specialists", "POST", { arena, niche: niche.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("specialists.hireFailed")));
      return;
    }
    setDone(res.body?.reused === true ? t("specialists.reused") : t("specialists.hired"));
    setNiche("");
    await onHired();
  }

  return (
    <form
      className="pop-panel stack-form hirepanel"
      aria-label={t("specialists.hireButton")}
      onSubmit={(e) => {
        e.preventDefault();
        void hire();
      }}
    >
      <div className="hireform">
        <label>
          <span>{t("specialists.arena")}</span>
          <select className="field" value={arena} onChange={(e) => setArena(e.target.value as GigArena)}>
            {GIG_ARENAS.map((a) => (
              <option key={a} value={a}>
                {fmt.arena(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("specialists.nicheLabel")}</span>
          <input className="field" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("specialists.nichePlaceholder")} maxLength={80} />
        </label>
        <div className="row-form">
          <button type="submit" className="btn primary" disabled={busy}>
            {t("lanes.hire")}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("lanes.close")}
          </button>
        </div>
      </div>
      <p className="quiet-line">{t("lanes.hireNote")}</p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="note-line">
          {done}
        </p>
      ) : null}
    </form>
  );
}
