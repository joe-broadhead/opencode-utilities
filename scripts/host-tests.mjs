// host-tests.mjs -- the host suite on every tested OpenCode release.
//
//   node scripts/host-tests.mjs
//
// Each release in TESTED_HOSTS (src/host/versions.ts) gets its own @opencode/sdk: the locked one for the version the
// lockfile pins, and the others installed from npm into a temp folder under the system's /tmp, outside the lockfile,
// once per run. HOST_SDK_DIR runs only that one SDK, which is how a single release is checked by hand.
//
// A release that fails fails this script, so CI cannot pass on a subset. A release that cannot be installed fails too:
// a version that did not run is not a version that passed.

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const LOCKED = JSON.parse(readFileSync(join(ROOT, "node_modules", "@opencode", "sdk", "package.json"), "utf8")).version

// The list is one array literal in TypeScript; read its strings, so this script needs no loader.
const source = readFileSync(join(ROOT, "src", "host", "versions.ts"), "utf8")
const list = /export const TESTED_HOSTS = \[([^\]]*)\]/u.exec(source)?.[1]
if (list === undefined) throw new Error("host-tests: TESTED_HOSTS is not an array literal in src/host/versions.ts")
const TESTED_HOSTS = [...list.matchAll(/"([^"]+)"/gu)].map((match) => match[1])
if (TESTED_HOSTS.length === 0) throw new Error("host-tests: TESTED_HOSTS is empty")
if (!TESTED_HOSTS.includes(LOCKED)) throw new Error(`host-tests: the locked @opencode/sdk ${LOCKED} is not in TESTED_HOSTS`)

const only = process.env.HOST_SDK_DIR !== undefined
const versions = only ? [undefined] : TESTED_HOSTS

const run = (args, env) => execFileSync("bun", args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } })

let failed = false
for (const version of versions) {
  console.log(`\n[host] OpenCode ${version ?? "the SDK in HOST_SDK_DIR"}`)
  if (only || version === LOCKED) {
    try {
      run(["test", "./test/host"])
    } catch {
      failed = true
    }
    continue
  }
  const dir = mkdtempSync(join(realpathSync("/tmp"), `utilities-sdk-${version}-`))
  try {
    // Its own package.json, so npm never walks up to the repository's.
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "utilities-host-sdk", private: true }))
    try {
      execFileSync("npm", ["install", `@opencode/sdk@${version}`, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: dir, stdio: "inherit" })
    } catch {
      console.error(`[host] @opencode/sdk ${version} could not be installed, so that release did not run.`)
      failed = true
      continue
    }
    try {
      run(["test", "./test/host"], { HOST_SDK_DIR: dir })
    } catch {
      failed = true
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failed) {
  console.error("\n[host] at least one tested release failed or did not run.")
  process.exit(1)
}
console.log(`\n[host] ${versions.length} host run(s) passed.`)
