// Packs one package the way it is published, from a staged copy, so the checked-in package.json stays as the workspace
// needs it:
//   the main package (the repository root)  drops the dev-only `workspaces` field;
//   a platform package (npm/<name>)          gains `os`, `cpu` and `libc` from PLATFORMS in src/domain/contract.ts.
// The checked-in platform manifests leave those fields out, so a plain `npm ci --ignore-scripts` installs the workspace
// on any machine. Usage: bun scripts/pack.mjs <package dir> <destination>. Prints npm pack's JSON report.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { PLATFORMS } from "../src/domain/contract.ts"

const [dir, destination] = process.argv.slice(2)
if (!dir || !destination) throw new Error("usage: bun scripts/pack.mjs <package dir> <destination>")
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
const platform = Object.values(PLATFORMS).find(p => p.package === manifest.name)
let packed
if (platform) {
  for (const field of ["os", "cpu", "libc"]) if (field in manifest) throw new Error(`${dir}/package.json sets ${field}; PLATFORMS is the only source`)
  packed = { ...manifest, os: [platform.os], cpu: [platform.cpu], ...platform.libc ? { libc: [platform.libc] } : {} }
} else if (manifest.name === "@joe-broadhead/opencode-utilities") {
  const { workspaces: _, ...rest } = manifest
  packed = rest
} else throw new Error(`${manifest.name} is neither the main package nor a platform package in PLATFORMS`)

// A tarball without the native manifest installs and then refuses every tool that needs a program. The manifest is a
// build output, so packing before the native step is the one way to ship that; refuse instead.
if (manifest.name === "@joe-broadhead/opencode-utilities" && !existsSync(join(dir, "manifest", "backends.json"))) {
  throw new Error(
    "NATIVE_FILES_MISSING: manifest/backends.json is not there, so this tarball would refuse every tool that needs a " +
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
