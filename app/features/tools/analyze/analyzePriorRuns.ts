// Pure prior-runs footprint calculations for the Analyze workspace.
// Before a run is submitted (and spent), this module inspects whether the attached
// CV content hashes have been analyzed before in the current workspace, either for
// the currently selected role or other roles.
import { MAX_CV_VARIANTS } from "../../../_lib/upload-constraints.ts";

export type PriorRunRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  created_at: string;
  disposition: string | null;
  cv_hash: string | null;
};

export type PriorRunQueryParams = {
  cvHashes?: readonly string[] | null;
  jdSlug?: string | null;
  blind?: boolean;
};

export type PriorRunQuery = {
  cvHashes: string[];
  jdSlug: string | null;
};

const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Builds and validates the prior-run query parameters.
 * Returns null if blind mode is on (footprint would re-identify the candidate),
 * or if no valid 64-character hex hashes are present.
 * Caps hashes at MAX_CV_VARIANTS (3).
 */
export function priorRunQuery(params: PriorRunQueryParams): PriorRunQuery | null {
  if (params.blind) return null;
  if (!params.cvHashes || !Array.isArray(params.cvHashes) || params.cvHashes.length === 0) {
    return null;
  }
  const validHashes = params.cvHashes
    .filter((h): h is string => typeof h === "string" && HEX_64_REGEX.test(h.trim()))
    .map((h) => h.trim().toLowerCase())
    .slice(0, MAX_CV_VARIANTS);

  if (validHashes.length === 0) return null;

  const jdSlug =
    typeof params.jdSlug === "string" && params.jdSlug.trim().length > 0
      ? params.jdSlug.trim()
      : null;

  return {
    cvHashes: validHashes,
    jdSlug,
  };
}

export type PriorOtherRole = {
  jdSlug: string | null;
  slug: string;
  candidateLabel?: string;
  score: number | null;
  createdAt: string;
};

export type PriorRunSummary =
  | { verdict: "none" }
  | {
      verdict: "seen-elsewhere";
      otherRoles: PriorOtherRole[];
      moreCount: number;
    }
  | {
      verdict: "seen";
      latest: { slug: string; score: number | null; createdAt: string };
      otherRoles?: PriorOtherRole[];
      moreCount?: number;
    }
  | {
      verdict: "decided";
      decision: { disposition: string; slug: string; createdAt: string };
      latest: { slug: string; score: number | null; createdAt: string };
      otherRoles?: PriorOtherRole[];
      moreCount?: number;
    };

/**
 * Summarizes prior run rows into one of 4 mutually exclusive verdicts:
 * - 'none': no rows found.
 * - 'decided': candidate was scored for the selected role AND has a recorded disposition (on any run).
 * - 'seen': candidate was scored for the selected role but not yet decided.
 * - 'seen-elsewhere': candidate was scored only under other roles.
 */
export function summarizePriorRuns(
  rows: readonly PriorRunRow[],
  opts: { jdSlug?: string | null }
): PriorRunSummary {
  if (!rows || rows.length === 0) {
    return { verdict: "none" };
  }

  const targetJd = opts.jdSlug?.trim() || null;
  const targetRows = targetJd ? rows.filter((r) => r.jd_slug === targetJd) : [];

  // Group other roles by jd_slug (taking newest run for each distinct other role)
  const otherRolesMap = new Map<string, PriorOtherRole>();
  for (const r of rows) {
    if (targetJd && r.jd_slug === targetJd) continue;
    const key = r.jd_slug ?? "__null__";
    if (!otherRolesMap.has(key)) {
      otherRolesMap.set(key, {
        jdSlug: r.jd_slug,
        slug: r.slug,
        candidateLabel: r.candidate_label,
        score: r.score,
        createdAt: r.created_at,
      });
    }
  }

  const allOtherRoles = Array.from(otherRolesMap.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  const otherRoles = allOtherRoles.slice(0, 3);
  const moreCount = Math.max(0, allOtherRoles.length - 3);

  if (targetRows.length > 0) {
    // Whichever row carries disposition (take first matching since rows are sorted created_at DESC)
    const decidedRow = targetRows.find(
      (r) => typeof r.disposition === "string" && r.disposition.trim().length > 0
    );

    const latestRow = targetRows[0];
    const latest = {
      slug: latestRow.slug,
      score: latestRow.score,
      createdAt: latestRow.created_at,
    };

    if (decidedRow && decidedRow.disposition) {
      return {
        verdict: "decided",
        decision: {
          disposition: decidedRow.disposition,
          slug: decidedRow.slug,
          createdAt: decidedRow.created_at,
        },
        latest,
        otherRoles: otherRoles.length > 0 ? otherRoles : undefined,
        moreCount: otherRoles.length > 0 ? moreCount : undefined,
      };
    }

    return {
      verdict: "seen",
      latest,
      otherRoles: otherRoles.length > 0 ? otherRoles : undefined,
      moreCount: otherRoles.length > 0 ? moreCount : undefined,
    };
  }

  if (allOtherRoles.length > 0) {
    return {
      verdict: "seen-elsewhere",
      otherRoles,
      moreCount,
    };
  }

  return { verdict: "none" };
}
