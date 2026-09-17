// Public apply form: the repo field is a URL, not a GitHub-shaped string.
// Contact already has a light shape check; repo used to accept any non-empty
// value and the placeholder was a hardcoded English GitHub example.

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function contactLooksLikeEmail(raw: string): boolean {
  return /\S+@\S+\.\S+/.test(raw.trim());
}

export function canSubmitDevApply(fields: {
  name: string;
  contact: string;
  repoRef: string;
  busy: boolean;
}): boolean {
  return (
    fields.name.trim().length > 0 &&
    contactLooksLikeEmail(fields.contact) &&
    isHttpUrl(fields.repoRef) &&
    !fields.busy
  );
}
