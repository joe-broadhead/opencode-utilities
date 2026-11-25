/** The helpers in `scripts/release-assets.mjs`, typed for the unit test. */
export function pinnedNames(
  manifest: { modules?: Record<string, Record<string, { name: string }>>; licences?: { name: string }[] },
): string[]
export function pinnedPaths(directory: string, names: readonly string[]): string[]
