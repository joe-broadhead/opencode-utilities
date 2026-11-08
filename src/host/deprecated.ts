// The ids this plugin answered to before the rename to `utilities.local`. They answer for one release, running the same
// handlers, so a script or a client written against the old id keeps working; status says so once one is called.

import { DEPRECATED_IDS } from "../domain/contract.js"

export type DeprecatedKind = "status" | "tools"

const called = new Set<DeprecatedKind>()

/** Records that an old id answered in this process. */
export const markAliasCalled = (kind: DeprecatedKind): void => void called.add(kind)

/** Forgets the calls: a reload starts again, so the note appears once per run of the plugin. */
export const resetAliases = (): void => void called.clear()

/**
 * The one line status shows after an old id is called, or undefined when none was. It names the old id, the new one to
 * use, and that the old one goes at the next minor release.
 */
export function deprecatedNote(): string | undefined {
  if (called.size === 0) return undefined
  const old = [...called].sort().map(kind => (kind === "status" ? DEPRECATED_IDS.status : DEPRECATED_IDS.tools))
  const replacement = [...called].sort().map(kind => (kind === "status" ? DEPRECATED_IDS.use : `${DEPRECATED_IDS.use}.tools`))
  return `Deprecated id called: ${old.join(", ")}. Use ${replacement.join(", ")} instead; the old id works until the next minor release.`
}
