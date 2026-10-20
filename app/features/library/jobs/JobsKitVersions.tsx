"use client";

// The kit's version history: every version, newest first, with where it came from
// (drafted from the posting, or edited) and when. The table is append-only, so this
// list only grows; its job is to say which version is LIVE (what new interview links
// are minted from) and to let a newer draft be published from here too.
//
// A draft OLDER than the live version is shown without a Publish button: new links mint
// from the highest published version, so publishing it would succeed and change
// nothing (jobsKitModel.canPublishVersion).
import type { useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { canPublishVersion, type KitState } from "./jobsKitModel";

type KitT = ReturnType<typeof useTranslations<"jobs.kit">>;

export function JobsKitVersions({
  state,
  publishing,
  onPublish,
  t,
}: {
  state: KitState;
  publishing: string | null;
  onPublish: (kitId: string) => void;
  t: KitT;
}) {
  const { date } = useDateFormat();
  if (state.versions.length === 0) return null;
  const liveId = state.published?.id ?? null;
  return (
    <section aria-label={t("versions")} className="space-y-2">
      <h4 className={META_LABEL}>{t("versions")}</h4>
      <ul className="divide-y divide-stone-200 rounded-md border border-stone-200">
        {state.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="font-semibold text-ink nums">{t("versionRow", { version: v.version })}</span>
            <span className={CHIP_QUIET}>
              {v.id === liveId ? t("versionLive") : v.status === "published" ? t("versionEarlier") : t("versionDraft")}
            </span>
            <span className="text-steel">
              {v.source === "edited" ? t("sourceEdited") : t("sourceGenerated")} · {date(v.createdAt)}
            </span>
            {canPublishVersion(v, state) ? (
              <button
                type="button"
                onClick={() => onPublish(v.id)}
                disabled={publishing !== null}
                aria-label={t("publishAria", { version: v.version })}
                className={`${BTN_SECONDARY} ml-auto h-8 px-2.5 text-sm`}
              >
                {publishing === v.id ? t("publishing") : t("publish")}
              </button>
            ) : v.status === "draft" ? (
              <span className="ml-auto text-steel">{t("publishOlder")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
