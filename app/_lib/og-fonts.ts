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
    const css = await fetchWithTimeout(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" },
    }).then((res) => res.text());
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontUrl = match[1].replace(/['"]/g, "");
    return await fetchWithTimeout(fontUrl).then((res) => res.arrayBuffer());
  } catch {
    return null;
  }
}
