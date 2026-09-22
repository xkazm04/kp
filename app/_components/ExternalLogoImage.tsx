import type { ComponentProps } from "react";
import { EXTERNAL_LOGO_IMG_ATTRS } from "@/app/_lib/brand-config";

type Props = Omit<ComponentProps<"img">, "src" | "alt" | "referrerPolicy"> & {
  src: string;
  alt: string;
};

/** Operator logos can come from arbitrary hosts. Keep the native image and its
 * referrer policy in one place instead of adding an optimization host allowlist. */
export function ExternalLogoImage(props: Props) {
  const { src, alt, ...rest } = props;
  // eslint-disable-next-line @next/next/no-img-element -- operator-provided external logo host
  return <img src={src} alt={alt} {...rest} {...EXTERNAL_LOGO_IMG_ATTRS} />;
}
