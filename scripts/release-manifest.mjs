#!/usr/bin/env node
// Checks the native workflow's candidate manifest before the release attaches it. `native.yml` uploads the manifest it
// built for every platform as the `native-manifest` artifact on master, with the native run id the release files are
// pinned to. The release downloads that artifact and calls this, so a manifest that names another tag, commit or
// repository stops the release before anything is published.
//
//   node scripts/release-manifest.mjs <native.json> <tag> <commit>
//
// `commit` is the tagged commit (GITHUB_SHA); the manifest's built.commit must be that commit, because its files were
// built from it. A tag whose commit has no native run attaches no native manifest or extras at all.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { manifestProblems } from "./native-manifest.mjs"

const REPOSITORY = "we-the-rebel-alliance/utilities-plugin"

/** The problems with a candidate release manifest, as sentences. An empty list means it can be attached to this tag. */
export function releaseManifestProblems(manifest, { tag, commit, repository = REPOSITORY } = {}) {
  return manifestProblems(manifest, { plugin: "utilities", tag, commit, repository })
}

function main() {
  const [path, tag, commit] = process.argv.slice(2)
  if (!path || !tag || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
    console.error("release-manifest: usage: node scripts/release-manifest.mjs <native.json> <tag> <commit>")
    process.exit(2)
  }
  const repository = process.env.GITHUB_REPOSITORY ?? REPOSITORY
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  const problems = releaseManifestProblems(manifest, { tag, commit, repository })
  if (problems.length) {
    console.error(`release-manifest: ${problems.join("; ")}`)
    process.exit(1)
  }
  console.log(`release-manifest: ${path} names ${tag} on ${commit.slice(0, 12)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(`release-manifest: ${error.message}`)
    process.exit(1)
  }
}
