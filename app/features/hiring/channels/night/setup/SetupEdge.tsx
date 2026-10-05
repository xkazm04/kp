"use client";

import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, Note, Tag, inputClass } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { BACKLOG_KEY, DRAIN_FAIL_KEY } from "../channelsNightCopy";
import { canSaveEdge, edgeCursorValue, edgeView } from "./setupDelivery";
import { SetupField, SetupResult } from "./SetupBits";
import { SetupSecretField } from "./SetupSecretField";
import { useEdgeSetup } from "./useEdgeSetup";

/**
 * The always-on edge: who answers while the studio is off. Offline mode and the env override say
 * so instead of a form that would not be used; a URL without its secret says which half is missing
 * (it once read "Paired" while nothing drained). The drain ledger states what the engine knows:
 * last drain, last beat, the backlog at the edge, the cursor, the secret (never shown), the nudge
 * target, and a failing drain by CLASS. Save / Pair, Drain now and Enable sealing are the real doors.
 */
export function SetupEdge() {
  const t = useTranslations("channels.edge");
  const ts = useTranslations("channelsNight.setup");
  const tAll = useTranslations();
  const fmt = useDateFormat();
  const rel = useRelativeTime();
  const e = useEdgeSetup();
  const s = e.state;
  const v = edgeView(s);
  const when = (iso: string | null) => (iso ? `${fmt.dateTime(iso)} · ${rel(iso)}` : null);
  const backlog = s?.pending == null ? "unknown" : s.pending > 0 ? "waiting" : "clear";

  return (
    <div className="cns-body">
      <p className="cns-intro">{t("intro")}</p>
      {s?.offline ? <Note tone="caution">{t("offlineNote")}</Note> : null}
      {v.secretMissing && !s?.offline ? <Note tone="caution">{t("secretMissingNote")}</Note> : null}
      {v.paired && s ? (
        <section className="cns-evidence" aria-label={ts("edge.ledger")}>
          <KeyValueGrid
            cols={3}
            items={[
              { label: tAll("channels.kit.lastDrain"), value: when(s.lastDrainAt), absent: t("neverDrained") },
              { label: tAll("channels.kit.lastHeartbeat"), value: when(s.lastHeartbeatAt), absent: ts("edge.noBeat") },
              { label: tAll("channels.kit.edgePending"), value: tAll(BACKLOG_KEY[backlog], { pending: s.pending ?? 0 }) },
              { label: tAll("channels.kit.edgeCursor"), value: edgeCursorValue(s), absent: t("neverDrained") },
              { label: t("secretLabel"), value: ts("secret.setHidden") },
              { label: ts("edge.nudge"), value: s.nudgeTarget, absent: tAll("channels.kit.notSet") },
            ]}
          />
          {s.lastErrorKind ? <Note tone="critical">{tAll(DRAIN_FAIL_KEY[s.lastErrorKind])}</Note> : null}
        </section>
      ) : null}
      {s?.offline ? null : s?.envConfigured ? (
        <Note tone="caution">{t("envNote")}</Note>
      ) : (
        <form
          className="cns-form cns-panel"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (canSaveEdge(s, e.url, e.busy !== null)) void e.save();
          }}
        >
          <SetupField label={t("urlLabel")}>
            {({ id }) => <input id={id} className={inputClass("md")} value={e.url} placeholder="https://…" spellCheck={false} autoComplete="off" onChange={(x) => e.setUrl(x.target.value)} />}
          </SetupField>
          <SetupSecretField
            key={`${e.saves}-${s?.hasSecret ?? "unread"}`}
            label={t("secretLabel")}
            has={Boolean(s?.hasSecret)}
            value={e.secret}
            onChange={e.setSecret}
            placeholder={t("secretPlaceholder")}
            keepPlaceholder={t("secretKeepPlaceholder")}
          />
          <SetupField label={t("nudgeLabel")}>
            {({ id }) => <input id={id} className={inputClass("md")} value={e.nudge} placeholder="https://ntfy.sh/…" spellCheck={false} autoComplete="off" onChange={(x) => e.setNudge(x.target.value)} />}
          </SetupField>
          <div className="cns-row">
            <Button type="submit" label={v.hasUrl ? t("save") : ts("edge.pair")} loading={e.busy === "save"} variant="primary" icon="check" disabled={!canSaveEdge(s, e.url, e.busy !== null)} />
          </div>
        </form>
      )}
      {s?.offline ? null : (
        <div className="cns-row">
          <Button label={t("drainNow")} loading={e.busy === "drain"} disabled={e.busy !== null || !v.paired} onClick={() => void e.drain()} />
          {v.paired && s && !s.sealed ? <Button label={t("enableSealing")} loading={e.busy === "seal"} disabled={e.busy !== null} onClick={() => void e.seal()} /> : null}
          {s?.sealed ? <Tag label={t("sealedBadge")} /> : null}
        </div>
      )}
      {e.note ? <SetupResult ok={e.note.ok}>{e.note.text}</SetupResult> : null}
    </div>
  );
}
