// Packs the main package the way it is published, from a staged copy of its whitelisted files. The package carries no
// program: the time and weather programs are downloaded from the release on first use, so a tarball without
// manifest/native.json is refused here.
// Usage: bun scripts/pack.mjs <package dir> <destination> [--without-native-manifest]. Prints npm pack's JSON report.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const args = process.argv.slice(2)
// --without-native-manifest packs a checkout whose native step has not run. Only the pack test passes it: a release tarball always has the manifest.
const withoutNative = args.includes("--without-native-manifest")
const [dir, destination] = args.filter(arg => !arg.startsWith("--"))
if (!dir || !destination) throw new Error("usage: bun scripts/pack.mjs <package dir> <destination> [--without-native-manifest]")
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
if (manifest.name !== "@joe-broadhead/opencode-utilities") throw new Error(`${manifest.name} is not the main package`)
const packed = manifest

// A tarball without the native manifest installs and then refuses every tool that needs a program. The manifest is a
// build output, so packing before the native step is the one way to ship that; refuse instead.
if (!withoutNative && !existsSync(join(dir, "manifest", "native.json"))) {
  throw new Error(
    "NATIVE_FILES_MISSING: manifest/native.json is not there, so this tarball would refuse every tool that needs a " +
      "program. Next step: Run npm run native:build, then pack again.",
  )
}

const stage = mkdtempSync(join(tmpdir(), "utilities-pack-"))
try {
  // Only what npm would pack: the files whitelist (npm adds package.json, README and LICENSE itself).
  for (const entry of manifest.files ?? []) if (existsSync(join(dir, entry))) cpSync(join(dir, entry), join(stage, entry), { recursive: true })
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(packed, null, 2)}\n`)
  process.stdout.write(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", resolve(destination)], { cwd: stage, encoding: "utf8" }))
} finally {
  rmSync(stage, { recursive: true, force: true })
}
