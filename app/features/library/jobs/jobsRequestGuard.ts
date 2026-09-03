// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #3): a "latest request
// wins" guard. A component that reuses one fetch loop across a changing key — the
// posting modal ranks Role A, then the recruiter switches it to Role B before A's
// slow ranking resolves — must DROP the stale response, or A's candidates overwrite
// B's list while the header shows Role B. Extracted from RecruiterCandidates as pure
// logic so the drop-stale rule is unit-testable (a .tsx can't be loaded by
// `node --test`). The component holds one instance in a useRef so `current` survives
// across renders; it calls begin(key) when a request starts and gates every state
// write behind isCurrent(key).
export type LatestRequestGuard = {
  /** Mark `key` as the newest in-flight request. */
  begin: (key: string) => void;
  /** True only while `key` is still the newest — i.e. safe to commit its response. */
  isCurrent: (key: string) => boolean;
};

export function makeLatestRequestGuard(): LatestRequestGuard {
  let current: string | null = null;
  return {
    begin: (key) => {
      current = key;
    },
    isCurrent: (key) => current === key,
  };
}

// A request is not always keyed by one value. The posting modal's campaign-pack
// probe is keyed by the job AND the posting language, and a key built by ad-hoc
// concatenation is a guard waiting to compare the wrong strings: "a" + "bc" and
// "ab" + "c" are the same key. Compose keys through here instead — the separator
// is a character no id or locale tag contains.
export function requestKey(...parts: string[]): string {
  return parts.join("\u0000");
}
