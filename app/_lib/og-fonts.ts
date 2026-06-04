// Fetch a Google Font with a hard deadline so a slow/stalled font server degrades
// gracefully (no-font fallback) instead of hanging the OG/icon routes or the build.
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// next/og weights we embed. A subset of the CSS weight scale, matching what the
// OG / apple-icon routes actually request (Fraunces 600/700, Inter 500).
export type OgFontWeight = 400 | 500 | 600 | 700;

export type OgFontSpec = {
  family: string;
  weight: OgFontWeight;
  /** Defaults to `family`; override when two specs share a family but need
   *  distinct descriptor names. */
  name?: string;
};

// The ready-to-spread shape next/og's ImageResponse expects in its `fonts` option.
export type OgFontDescriptor = { name: string; data: ArrayBuffer; weight: OgFontWeight; style: "normal" };

// Load several Google fonts in parallel and return next/og's `fonts` descriptor
// array with any that timed out / failed (loadGoogleFont returns null) ALREADY
// dropped — so an image route can pass the result straight to ImageResponse
// without re-implementing the push-if-non-null guard. Centralizing that guard
// here, next to loadGoogleFont (which owns the timeout/fallback), keeps the whole
// font-or-nothing graceful-degradation contract in one place: a forgotten guard
// would otherwise feed a null `data` into ImageResponse.
export async function loadOgFonts(specs: ReadonlyArray<OgFontSpec>): Promise<OgFontDescriptor[]> {
  const loaded = await Promise.all(specs.map((s) => loadGoogleFont(s.family, s.weight)));
  const fonts: OgFontDescriptor[] = [];
  specs.forEach((spec, i) => {
    const data = loaded[i];
    if (data) fonts.push({ name: spec.name ?? spec.family, data, weight: spec.weight, style: "normal" });
  });
  return fonts;
}

// Pick the LATIN font subset URL out of a Google css2 response. Google emits one
// @font-face block per unicode-range (cyrillic, greek, vietnamese, latin-ext,
// latin), and `latin` is typically LAST. The old "first src: url()" match grabbed
// a non-latin subset that lacks the basic-Latin glyphs the OG titles use ("Job
// Fit", "Salary Estimator"), so Satori rendered tofu / dropped the title. Parse
// every block and prefer the one whose unicode-range covers basic Latin
// (U+0000–U+00FF); fall back to the last src only if none is tagged. Exported for
// unit testing. Returns null when no @font-face carries a usable src url.
export function pickFontUrl(css: string): string | null {
  let lastSrc: string | null = null;
  let latinSrc: string | null = null;
  // Split on @font-face so each chunk holds one face's src + unicode-range. The
  // leading chunk (before the first @font-face) carries no src and is skipped.
  for (const block of css.split("@font-face")) {
    const srcMatch = block.match(/src:\s*url\(([^)]+)\)/);
    if (!srcMatch) continue;
    const url = srcMatch[1].replace(/['"]/g, "");
    lastSrc = url;
    // The latin block's unicode-range starts with the basic-Latin span; no other
    // Google subset lists U+0000-00FF.
    if (/unicode-range:[^;]*U\+0000-00FF/i.test(block)) latinSrc = url;
  }
  return latinSrc ?? lastSrc;
}

export async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    const cssRes = await fetchWithTimeout(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" },
    });
    // A 429/5xx or an HTML error page must not be parsed as font CSS — bail to the
    // no-font fallback instead of feeding bogus bytes into ImageResponse downstream.
    if (!cssRes.ok || !(cssRes.headers.get("content-type") ?? "").toLowerCase().includes("css")) return null;
    const css = await cssRes.text();
    const fontUrl = pickFontUrl(css);
    if (!fontUrl) return null;
    const fontRes = await fetchWithTimeout(fontUrl);
    // Likewise guard the binary fetch: only hand real font bytes back to the caller.
    const fontType = (fontRes.headers.get("content-type") ?? "").toLowerCase();
    if (!fontRes.ok || !(fontType.includes("font") || fontType.includes("octet-stream"))) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}
