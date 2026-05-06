export async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    const css = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" }
    }).then((res) => res.text());
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontUrl = match[1].replace(/['"]/g, "");
    return await fetch(fontUrl).then((res) => res.arrayBuffer());
  } catch {
    return null;
  }
}
