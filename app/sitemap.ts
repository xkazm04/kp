import type { MetadataRoute } from "next";
import { siteUrl } from "@/app/_lib/site-url";

// The publicly indexable surfaces only: the landing ('/'), the case write-up
// (/about) and the Czech market atlas (/market). The operator dashboard also
// lives at '/' but is served behind the sign-in gate, so a crawler (anonymous)
// gets the landing. Per-token candidate pages and the API are excluded here and
// disallowed in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();
  return [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    { url: url("/about"), changeFrequency: "monthly", priority: 0.6 },
    { url: url("/market"), changeFrequency: "weekly", priority: 0.6 },
  ];
}
