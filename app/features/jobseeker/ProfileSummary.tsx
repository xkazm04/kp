"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Download, MessageSquareText, Printer, RefreshCw, Sparkles } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, CHIP, CHIP_QUIET, EYEBROW, META_LABEL, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import type { JobseekerDialog, JobseekerPreferences, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { provLabel } from "@/app/features/shared/matchTypes";
import { recallDraftSource } from "./importOutcome";

// The seeker's profile as a card: WHAT WAS READ (name, role family, years, skills,
// location, languages), WHAT COULD NOT BE READ (shown as gaps to fill in the studio,
// never scored as absence), the preferences the studio elicited as chips — the
// salary floor in the currency it was stated in, never converted — and the three
// doors: polish, download, print.

const FIELD_KEYS = ["name", "roleFamily", "years", "skills", "location", "languages", "education"] as const;

/** The draft's reader is written once, at import, and never changes under the open
 *  page — so the store has nothing to subscribe to. */
const noDraftSourceSubscription = () => () => undefined;

type FieldKey = (typeof FIELD_KEYS)[number];

function readField(profile: JobseekerProfile["profile"], key: FieldKey): string | null {
  switch (key) {
    case "name":
      return profile.displayName?.trim() || null;
    case "roleFamily":
      return profile.roleFamily?.trim() || null;
    case "years":
      return typeof profile.yearsExperience === "number" ? String(profile.yearsExperience) : null;
    case "skills":
      return profile.skillClaims?.length ? String(profile.skillClaims.length) : null;
    case "location":
      return profile.location?.trim() || null;
    case "languages":
      return profile.languages?.length ? profile.languages.join(", ") : null;
    case "education":
      return profile.educationLevel && profile.educationLevel !== "unknown" ? profile.educationLevel : null;
  }
}

/** The stored preferences as display chips. The floor is `amount currency period`
 *  with the amount grouped in the reader's locale and the currency AS STORED. */
export function preferenceChips(
  prefs: JobseekerPreferences,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string
): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [];
  for (const place of prefs.locations) chips.push({ key: `loc:${place}`, label: place });
  for (const c of prefs.countries) chips.push({ key: `country:${c}`, label: c.toUpperCase() });
  for (const m of prefs.workModes) chips.push({ key: `mode:${m}`, label: t(`workMode.${m}`) });
  if (prefs.salaryFloor) {
    const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(prefs.salaryFloor.amount);
    chips.push({
      key: "floor",
      label: t("salaryFloor", { amount, currency: prefs.salaryFloor.currency, period: t(`period.${prefs.salaryFloor.period}`) }),
    });
  }
  for (const title of prefs.targetTitles) chips.push({ key: `title:${title}`, label: title });
  if (prefs.seniority) chips.push({ key: "seniority", label: t(`seniority.${prefs.seniority}`) });
  return chips;
}

export function ProfileSummary({
  profile,
  opening,
  openError,
  studioOpen,
  onOpenStudio,
  onOpenDialog,
  onReimport,
}: {
  profile: JobseekerProfile;
  opening: boolean;
  openError: string | null;
  studioOpen: boolean;
  onOpenStudio(): void;
  onOpenDialog(dialog: JobseekerDialog): void;
  onReimport(): void;
}) {
  const t = useTranslations("me.profile");
  const tPrefs = useTranslations("me.preferences");
  const tCv = useTranslations("me.cv");
  const locale = useLocale();
  const read = FIELD_KEYS.map((key) => ({ key, value: readField(profile.profile, key) }));
  const missing = read.filter((f) => f.value === null);
  const chips = preferenceChips(profile.preferences, locale, (k, v) => tPrefs(k as Parameters<typeof tPrefs>[0], v));
  const hasCv = Boolean(profile.cvPolishedMd);
  const enumLabel = useEnumLabel();
  const skills = profile.profile.skillClaims ?? [];

  // WHO READ THE CV, carried across a reload of /me. The stored row has no column
  // for it (see importOutcome.ts), so the import leaves it in sessionStorage under
  // this profile's id; a tab that never ran the import shows no claim at all, which
  // is the safe direction — the assertion we must never make is "a model read this".
  // Read through useSyncExternalStore, not an effect: sessionStorage is a browser
  // API the server snapshot cannot have, so the server renders `null` and the client
  // reads the real value on hydration without a cascading setState.
  const draftSource = useSyncExternalStore(
    noDraftSourceSubscription,
    () => recallDraftSource(profile.id),
    () => null
  );

  // The conversation ledger: newest first, so a closed polish can be reopened
  // read-only (its transcript is the record of what was suggested and why).
  const [dialogs, setDialogs] = useState<JobseekerDialog[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profile.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { dialogs?: JobseekerDialog[] } | null) => {
        if (alive) setDialogs((body?.dialogs ?? []).filter((d) => d.kind === "cv_polish").slice(0, 5));
      })
      .catch(() => {
        /* best-effort: the ledger is context, never the page */
      });
    return () => {
      alive = false;
    };
  }, [profile.id, profile.updatedAt, studioOpen]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className={`${PANEL} ${CARD_PAD} space-y-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={EYEBROW}>{t("readTitle")}</p>
            <h2 className="mt-1 font-serif text-h2 text-ink">{profile.profile.displayName?.trim() || t("unknownName")}</h2>
            <p className="mt-1 text-sm text-steel">{t("updated", { when: formatRelativeTime(profile.updatedAt, locale) })}</p>
          </div>
          <button type="button" className={`${BTN_GHOST} h-9 px-3`} onClick={onReimport}>
            <RefreshCw size={14} aria-hidden /> {t("reimport")}
          </button>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {read
            .filter((f) => f.value !== null)
            .map((f) => (
              <div key={f.key}>
                <dt className={META_LABEL}>{t(`field.${f.key}`)}</dt>
                <dd className="mt-0.5 text-body text-ink">{f.value}</dd>
              </div>
            ))}
        </dl>

        {draftSource === "deterministic" ? (
          <div className={`${NOTICE("amber")} px-3 py-2`} role="status">
            <p className="text-sm font-semibold">{t("readWithoutAiTitle")}</p>
            <p className="mt-0.5 text-sm">{t("readWithoutAiBody")}</p>
          </div>
        ) : null}

        {/* Each claim carries WHERE IT CAME FROM. A deterministic read mints
            `self_declared` for everything, and a chip that shows only the skill
            presents a claim the CV made as a fact the app checked. */}
        {skills.length > 0 ? (
          <div className="border-t border-stone-200 pt-4">
            <p className={META_LABEL}>{t("skillsTitle")}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((s, i) => {
                const skill = s.skill?.trim();
                if (!skill) return null;
                const prov = provLabel(s.provenance ?? "self_declared");
                const label =
                  prov.key === "self_declared"
                    ? t("skillSelfDeclared", { skill })
                    : t("skillProvenance", { skill, provenance: enumLabel("provenance", s.provenance ?? prov.key) });
                return (
                  <li key={`${skill}:${i}`} className={CHIP_QUIET} title={label} aria-label={label}>
                    {skill}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* What the pipeline could not read — a list to fill, never a score. */}
        <div className="border-t border-stone-200 pt-4">
          <p className={META_LABEL}>{t("couldNotReadTitle")}</p>
          {missing.length === 0 ? (
            <p className="mt-1 text-sm text-steel">{t("couldNotReadNone")}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-steel">{t("couldNotReadBody")}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {missing.map((f) => (
                  <li key={f.key} className={CHIP_QUIET}>
                    {t(`field.${f.key}`)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
          <button type="button" className={`${BTN_PRIMARY} h-10 px-5`} disabled={opening} onClick={onOpenStudio}>
            <Sparkles size={16} aria-hidden /> {tCv("open")}
          </button>
          {hasCv ? (
            <a href="/api/jobseeker/cv.md" download="cv.md" className={`${BTN_SECONDARY} h-10 px-4`}>
              <Download size={16} aria-hidden /> {tCv("download")}
            </a>
          ) : (
            <span className={`${BTN_SECONDARY} h-10 cursor-not-allowed px-4 opacity-50`} aria-disabled title={tCv("downloadUnavailable")}>
              <Download size={16} aria-hidden /> {tCv("download")}
            </span>
          )}
          {hasCv ? (
            <Link href="/me/cv/print" target="_blank" rel="noopener" className={`${BTN_SECONDARY} h-10 px-4`}>
              <Printer size={16} aria-hidden /> {tCv("print")}
            </Link>
          ) : null}
        </div>
        {openError ? (
          <p className="text-sm text-coral" role="alert">
            {openError}
          </p>
        ) : null}
      </section>

      <div className="space-y-6">
        <section className={`${PANEL} ${CARD_PAD}`}>
          <p className={EYEBROW}>{tPrefs("title")}</p>
          {chips.length === 0 ? (
            <p className="mt-2 text-sm text-steel">{tPrefs("empty")}</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <li key={c.key} className={CHIP}>
                  {c.label}
                </li>
              ))}
            </ul>
          )}
          {profile.preferences.languages.length > 0 ? (
            <p className="mt-3 text-sm text-steel">{tPrefs("languages", { list: profile.preferences.languages.join(", ") })}</p>
          ) : null}
        </section>

        {dialogs.length > 0 ? (
          <section className={`${PANEL} ${CARD_PAD}`}>
            <p className={EYEBROW}>{tCv("past")}</p>
            <ul className="mt-3 divide-y divide-stone-200">
              {dialogs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <MessageSquareText size={14} aria-hidden className="shrink-0 text-steel" />
                    <span className="truncate">{formatRelativeTime(d.updatedAt, locale)}</span>
                    <span className={CHIP_QUIET}>{tCv(`status.${d.status}`)}</span>
                  </span>
                  <button type="button" className={`${BTN_GHOST} h-8 px-2 text-sm`} disabled={opening} onClick={() => onOpenDialog(d)}>
                    {d.status === "open" ? tCv("resume") : tCv("openReadOnly")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
