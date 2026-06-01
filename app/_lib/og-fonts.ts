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
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontUrl = match[1].replace(/['"]/g, "");
    const fontRes = await fetchWithTimeout(fontUrl);
    // Likewise guard the binary fetch: only hand real font bytes back to the caller.
    const fontType = (fontRes.headers.get("content-type") ?? "").toLowerCase();
    if (!fontRes.ok || !(fontType.includes("font") || fontType.includes("octet-stream"))) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}
