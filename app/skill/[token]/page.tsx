import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { verifySkillProfileToken } from "@/app/_lib/db/skill-profiles";
import { skillProfileFreshnessNow, resolveSkillProfileCardState, skillProfileShowsScoreCard } from "@/app/_lib/skill-profile";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import SkillKitView from "./kit/SkillKitView";
import type { SkillKitCard } from "./kit/skillKitModel";

// The credential PAGE was the only public token door with no throttle at all: its
// sibling /api/skill-profile/[token]/verify has had 30/10min per client since the
// enumeration finding, but the page behind the same token space did a sqlite read
// plus an HMAC verification per hit, unmetered — so the cheap way to walk the token
// space was simply to ask for the HTML instead of the JSON. Same budget as the
// verify route, keyed per client AND token so one candidate reloading their own
// card can never spend another's bucket.
const SKILL_VIEW_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };


// Durable Skill Profile (moonshot A) — the public, candidate-owned, shareable
// score-card. Token-gated (mirrors /offer/[token]); renders the signed credential
// and a tamper-evident "verified by kp" verdict computed server-side. Explainable
// by construction: shows the durable axes + propagated confidence + a methodology
// link, never just a bare number.
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function SkillProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tAxis = await getTranslations("devcase.dimension");
  const format = await getFormatter();
  // An RSC page has no NextRequest, so the client address comes off the request
  // headers the same way a route handler resolves it (clientIpFrom -> the trusted-
  // proxy-aware resolveClientIp). Nothing here can answer 429 — a page renders a
  // page — so the refusal is a rendered state that says plainly that the card is
  // temporarily unavailable and is worth retrying, which is the honest reading of a
  // throttle and never implies the credential is bad.
  if (!rateLimit(`skill-view:${clientIpFrom(await headers())}:${token}`, SKILL_VIEW_RATE_LIMIT)) {
    // The throttled letter renders t("throttledTitle") / t("throttledBody") (SkillKitView).
    return <SkillKitView card={{ kind: "throttled" }} />;
  }
  const verdict = verifySkillProfileToken(token);
  if (!verdict.found || !verdict.profile) notFound();

  const p = verdict.profile;
  const axes = Object.entries(p.axes);
  const confidencePct = Math.round((p.confidence ?? 0) * 100);
  const issued = format.dateTime(new Date(p.issuedAt), { dateStyle: "medium" });
  // A validly-signed but SUBSTANTIVELY EMPTY credential (no axes, transfer score 0) is
  // NOT a confident "verified" verdict — it's an "incomplete" attestation, shown muted
  // so a third party never reads a green shield over a 0.
  //
  // "unverifiable" comes BEFORE "tampered": when kp cannot check the signature because the
  // credential key is unset/misconfigured server-side (verdict.verifiable === false), that
  // is OUR configuration problem, not evidence the bearer forged anything. It renders a
  // NEUTRAL "cannot verify" badge — never the red fraud accusation — so a KP_SECRET rotation
  // or a missing KP_SKILL_PROFILE_KEY can't defame a genuine, non-revoked credential.
  //
  // "stale" is the LAST downgrade (bug-ui-scan-2026-07-09 (skill-matrix-coverage #3)): a
  // genuine, non-revoked, untampered, substantive credential that is nonetheless OLD (issued
  // past the validity window) or signed under a superseded methodology. The green shield
  // over-asserts freshness — a third party reads "Verified" as "current" — so a stale
  // credential drops to a muted amber "issued a while ago" verdict with the numbers still
  // shown, never a confident green. Integrity is unaffected; only currency is flagged.
  const freshness = skillProfileFreshnessNow(p);
  const state = resolveSkillProfileCardState({
    revoked: verdict.revoked,
    verifiable: verdict.verifiable,
    valid: verdict.valid,
    substantive: verdict.substantive,
    stale: freshness.stale,
  });

  // Everything the letter shows is resolved HERE, on the server, and handed over as plain props:
  // the client letter never refetches, and the server HTML is the whole card (it prints without
  // JavaScript). Markup: ./kit/SkillKitView, the composition-kit letter (Gate 2, kit-unification).
  const card: SkillKitCard = {
    kind: "card",
    state,
    showsScores: skillProfileShowsScoreCard(state),
    transferScore: p.transferScore,
    confidencePct,
    issued,
    version: p.version,
    staleReason: freshness.reason,
    axes: axes.map(([name, score]) => {
      const axisKey = name as Parameters<typeof tAxis>[0];
      return { name, label: tAxis.has(axisKey) ? tAxis(axisKey) : name, score };
    }),
  };

  return <SkillKitView card={card} />;
}
