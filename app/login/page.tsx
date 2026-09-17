import { signupEnabled } from "@/app/_lib/workspace-lock";
import { LoginClient } from "./LoginClient";

// The sign-in form renders under the per-request locale layout (useTranslations
// reads the provider's messages, which the layout resolves per request), so it
// can't be statically prerendered under Cache Components. Block it. `instant` is
// route segment config, so it lives on this Server Component wrapper; the form
// stays in the "use client" LoginClient child.
export const instant = false;

export default function LoginPage() {
  // Same server-resolved bit the landing hero uses: /signup 404s when the flag
  // is off, so the client must never guess from a public env mirror.
  return <LoginClient signupOpen={signupEnabled()} />;
}
