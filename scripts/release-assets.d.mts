/** The helpers in `scripts/release-assets.mjs`, typed for the unit test. */
export function pinnedNames(
  manifest: { modules?: Record<string, Record<string, { name: string }>>; licences?: { name: string }[] },
  speech?: { engines?: Record<string, { name: string }>; models?: Record<string, { name: string }> },
): string[]
export function pinnedPaths(directory: string, names: readonly string[]): string[]
