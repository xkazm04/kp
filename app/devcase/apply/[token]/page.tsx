import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Markdown } from "@/app/_components/Markdown";
import { getDevCase, getPostingByToken } from "@/app/_lib/db";
import { caseToMarkdown } from "@/app/features/tools/devcases/DevHelpers";
import type { CaseScenario, RoleSpec, SeedFile } from "@/app/features/tools/devcases/DevTypes";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { DevApplyForm } from "./DevApplyForm";
import { LiveWorkSurface } from "./LiveWorkSurface";


// W5-1 (DEVS1+DEVO1) — the candidate-facing page behind the dev-case apply
// token. The link recruiters copied used to be the POST-only inbound webhook
// (a browser got a 405): no brief, no starter files, no way to submit. This
// page follows the proven public token-surface pattern (/apply/[id],
// /schedule/[token], /offer/[token]): resolve the posting by its bearer token,
// render the PROBE-SAFE assignment (caseToMarkdown excludes probes by
// construction — never render the raw case object here), offer the
// materialized starter seed, and submit through the same inbound webhook
// external channels use (ack comms + lifecycle resume come free).
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function DevCaseApplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const posting = getPostingByToken(token);
  if (!posting) notFound();

  const t = await getTranslations("devApply");

  // W5-3 — a closed posting renders an honest closure card instead of
  // collecting applications nobody will process.
  if (posting.status === "closed") {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">{posting.caseTitle || posting.roleTitle || t("fallbackTitle")}</h1>
        <p className="mt-4 rounded-lg border border-stone-200 bg-paper/60 p-4 text-body text-steel">{t("closed")}</p>
      </main>
    );
  }

  const devCase = posting.caseId ? getDevCase(posting.caseId) : null;
  const kase = (devCase?.case ?? null) as CaseScenario | null;
  const role = (devCase?.role ?? null) as RoleSpec | null;
  const markdown = kase ? caseToMarkdown(kase, role) : null;

  // The persisted seed is the FROZEN assignment (bug-ui-scan-2026-07-09 #1): the
  // orchestrator materializes it ONCE, before minting this posting's token, and the
  // lifecycle never overwrites it after the token is live (saveDevCaseSeedIfAbsent).
  // So reading it per-request here is safe — every candidate on this posting gets the
  // byte-identical seed (and therefore the same submit channel below), never a fresh
  // non-deterministic render swapped in by a resume mid-flight.
  // Defensive narrow of the persisted seed ({files: [{path, contents}], note}).
  const seedRaw = devCase?.seed as { files?: unknown; note?: unknown } | null;
  const seedFiles: SeedFile[] = Array.isArray(seedRaw?.files)
    ? seedRaw.files.filter(
        (f): f is SeedFile =>
          typeof f === "object" && f !== null &&
          typeof (f as SeedFile).path === "string" &&
          typeof (f as SeedFile).contents === "string"
      )
    : [];
  const seedNote = typeof seedRaw?.note === "string" ? seedRaw.note : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">
        {posting.caseTitle || kase?.title || posting.roleTitle || t("fallbackTitle")}
      </h1>
      {posting.roleTitle && posting.caseTitle ? (
        <p className="mt-1 text-body text-steel">{posting.roleTitle}</p>
      ) : null}
      <p className="mt-2 text-body text-steel">{t("subtitle")}</p>

      {/* AI-use disclosure (UAT M9): this is the surface where AI evaluates the
          candidate, so it carries the same transparency note as the apply/offer
          surfaces — with the data-consent line, since submitting here IS consent. */}
      <AiDisclosure showDataConsent className="mt-4" />

      {markdown ? (
        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <Markdown content={markdown} />
        </section>
      ) : (
        <p className="mt-6 rounded-lg border border-stone-200 bg-paper/60 p-4 text-body text-steel">
          {t("briefUnavailable")}
        </p>
      )}

      {/* ONE submit path (UAT M9): a workspace case submits through the live
          surface (it grades the observed process and now carries identity); a case
          with no workspace submits through the repo-link form. Never both at once. */}
      {seedFiles.length > 0 ? (
        <LiveWorkSurface token={token} seedFiles={seedFiles} note={seedNote} />
      ) : (
        <section className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
          <h2 className="font-serif text-h3 text-ink">{t("submitHeading")}</h2>
          <p className="mt-1 text-sm text-steel">{t("submitHint")}</p>
          <DevApplyForm token={token} />
        </section>
      )}
    </main>
  );
}
