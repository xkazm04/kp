import type { ComponentProps } from "react";
import { EXTERNAL_LOGO_IMG_ATTRS, sanitizeLogoUrl } from "@/app/_lib/brand-config";

type Props = Omit<ComponentProps<"img">, "src" | "alt" | "referrerPolicy"> & {
  src: string;
  alt: string;
};

/** Operator logos can come from arbitrary hosts. Keep the native image and its
 * referrer policy in one place instead of adding an optimization host allowlist. */
export function ExternalLogoImage(props: Props) {
  const { src, alt, ...rest } = props;
  // The editors pass raw typed text, so vet it here with the store's own rule. A value the
  // store would refuse gets `data:,` (empty, fails to decode): onError still fires and the
  // caller falls back, exactly as when the load 404ed.
  const safeSrc = sanitizeLogoUrl(src) ?? "data:,";
  // eslint-disable-next-line @next/next/no-img-element -- operator-provided external logo host
  return <img src={safeSrc} alt={alt} {...rest} {...EXTERNAL_LOGO_IMG_ATTRS} />;
}
