/** Keep registered kinds available even when the recent task window is empty. */
export function filterableTaskKinds(registered: readonly string[], tasks: readonly { kind: string }[]): string[] {
  return [...new Set([...registered, ...tasks.map((task) => task.kind)])].sort();
}
