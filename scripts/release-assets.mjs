#!/usr/bin/env node
// Prints the exact asset paths `gh release create` must upload for the pinned native and speech files, one per line:
// every `name` in `manifest/native.json` (each module platform and each licence) and every `name` in
// `manifest/speech-assets.json` (engines and models). The release never passes `release/native`, `release/native/*` or
// a `find` listing, so a directory can never reach `gh release create` as an asset. Every listed file must be staged,
// and a staged file no manifest names is refused: the release carries exactly what the pins describe.
//
//   node scripts/release-assets.mjs <staging directory>
//
// A repository with no `manifest/native.json` prints nothing and exits 0: it has no native or speech extras.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { MANIFEST_PATH } from "./native-manifest.mjs"

/** Every file name the two manifests pin, in a stable order: modules, licences, speech engines, speech models. */
export function pinnedNames(manifest, speech) {
  const names = []
  for (const platforms of Object.values(manifest.modules ?? {})) {
    for (const entry of Object.values(platforms ?? {})) names.push(entry.name)
  }
  for (const licence of manifest.licences ?? []) names.push(licence.name)
  for (const entry of Object.values(speech?.engines ?? {})) names.push(entry.name)
  for (const entry of Object.values(speech?.models ?? {})) names.push(entry.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate) throw new Error(`the manifests pin ${duplicate} twice`)
  if (names.some(name => typeof name !== "string" || !name || name.includes("/"))) {
    throw new Error("every manifest name must be a plain file name")
  }
  return names
}

/** The staged paths for every pinned name; a missing file or an unnamed extra stops the release. */
export function pinnedPaths(directory, names) {
  const paths = names.map(name => join(directory, name))
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${path} is not a staged file`)
  }
  const extra = readdirSync(directory).filter(name => !names.includes(name))
  if (extra.length) throw new Error(`${directory} holds files no manifest names: ${extra.join(", ")}`)
  return paths
}

function main() {
  const directory = process.argv[2]
  if (!directory) throw new Error("usage: node scripts/release-assets.mjs <staging directory>")
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`release-assets: no ${MANIFEST_PATH}, so this release has no native or speech extras`)
    return
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  const speechPath = join("manifest", "speech-assets.json")
  const speech = existsSync(speechPath) ? JSON.parse(readFileSync(speechPath, "utf8")) : undefined
  for (const path of pinnedPaths(directory, pinnedNames(manifest, speech))) console.log(path)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(`release-assets: ${error.message}`)
    process.exit(1)
  }
}
