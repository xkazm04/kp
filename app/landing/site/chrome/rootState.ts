/** Selector of the site root rendered by <MkRoot>. */
export const MK_ROOT_SELECTOR = "[data-mk-root]";

/**
 * The site root that contains `node`: where the prototype's scripts wrote to
 * document.body / documentElement (data-intro, is-intro, reduced, is-leaving,
 * the --sc colour), a port writes here. Call it from an effect or a handler,
 * never during render.
 */
export function mkRootOf(node: Element | null | undefined): HTMLElement | null {
  return node?.closest<HTMLElement>(MK_ROOT_SELECTOR) ?? null;
}
