/** The candidate-manifest check in `scripts/release-manifest.mjs`, typed for the unit test. */
export function releaseManifestProblems(
  manifest: unknown,
  options?: { tag?: string; commit?: string; repository?: string },
): string[]
