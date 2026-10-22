// Who can open a link built on this origin (CX S39, seam "channels -> candidate reach").
//
// An owner who runs KandiDate on a laptop (`npm run up`, http://localhost:3000) copies an
// apply link and sends it to a candidate. `publicBaseUrl` falls back to the runtime origin
// when nothing is configured, so that link is http://localhost:3000/apply/<id> — and the
// candidate's phone cannot open it. Nothing said so. This decides, from the origin alone,
// which audience a link reaches, so every copy surface (and the Channels careers
// plate) can say it out loud. It never blocks a copy: a link that only the owner's network
// can open is still the right link for a candidate in the same office.
//
//   this-computer   localhost, *.localhost, 127.0.0.0/8, ::1, 0.0.0.0 / ::
//   local-network   RFC 1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16,
//                   fe80::/10), IPv6 unique-local (fc00::/7), CGNAT/tailnet (100.64/10),
//                   *.local (mDNS), and a bare host name with no dot
//   nowhere         a reserved name no one resolves (RFC 2606/6761: *.example, *.invalid,
//                   *.test). This is what a link becomes when the owner opens KandiDate on
//                   an address publicBaseUrl does not trust and nothing is configured: it
//                   falls back to siteUrl()'s placeholder, https://kandidate.example.
//   public          anything else — a claim about the ADDRESS, not a probe: a public name
//                   can still be firewalled; this only refuses to call a private one public.
//
// Pure: no env, no network. Callers pass the SAME base the link is built on
// (`publicBaseUrl(...)`), so the notice and the link can never disagree.

export type LinkReach = "this-computer" | "local-network" | "nowhere" | "public";

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function reachOfIpv4([a, b]: number[]): LinkReach {
  if (a === 127 || a === 0) return "this-computer";
  if (a === 10) return "local-network";
  if (a === 172 && b >= 16 && b <= 31) return "local-network";
  if (a === 192 && b === 168) return "local-network";
  if (a === 169 && b === 254) return "local-network";
  if (a === 100 && b >= 64 && b <= 127) return "local-network";
  return "public";
}

function reachOfIpv6(host: string): LinkReach {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return "this-computer";
  // IPv4-mapped (::ffff:127.0.0.1, or the hex form URL normalises it to).
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (mapped) {
    const dotted = ipv4(mapped[1]);
    if (dotted) return reachOfIpv4(dotted);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1]);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return reachOfIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
  }
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return "local-network";
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return "local-network";
  return "public";
}

/** Which audience can open a link on `origin` (an origin, a full URL, or a bare host). */
export function linkReach(origin: string): LinkReach {
  const raw = origin.trim();
  if (!raw) return "this-computer";
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    // Not an address anyone can open; never call it public.
    return "this-computer";
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) return reachOfIpv6(host.slice(1, -1));
  if (host === "localhost" || host.endsWith(".localhost")) return "this-computer";
  const v4 = ipv4(host);
  if (v4) return reachOfIpv4(v4);
  if (/(^|\.)(example|invalid|test)$/.test(host)) return "nowhere";
  if (host.endsWith(".local")) return "local-network";
  if (!host.includes(".")) return "local-network";
  return "public";
}
