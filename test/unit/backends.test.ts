// The plugin is the bundle plus its native files: manifest/backends.json is a build output, and a checkout without it
// installs, loads, and then refuses every tool that needs a program. That must say so, not look like a version clash.
import { describe, expect, test } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Backends, detectTarget } from "../../src/domain/backends.js"

const repo = fileURLToPath(new URL("../../", import.meta.url))

/** Never under the real home, and never under a link: the plugin refuses both. */
const TEMP = existsSync("/private/tmp") ? "/private/tmp" : "/tmp"

/** A package root holding one manifest, and nothing else. */
function packageRoot(manifest: string | undefined): string {
  const root = realpathSync(mkdtempSync(join(TEMP, "utilities-backends-")))
  mkdirSync(join(root, "manifest"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "backends-test", version: "0.0.0" }))
  if (manifest !== undefined) writeFileSync(join(root, "manifest", "backends.json"), manifest)
  return root
}

describe("the native manifest", () => {
  test("a checkout with no manifest says the platform files are missing, not that the contract clashed", async () => {
    const root = packageRoot(undefined)
    try {
      await expect(new Backends(root, detectTarget()).platform()).rejects.toMatchObject({ code: "NATIVE_FILES_MISSING" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a manifest that is not the one this version writes is a contract mismatch", async () => {
    for (const manifest of ["{", JSON.stringify({ platforms: { "darwin-arm64": { time: { path: "/etc/passwd" } } } })]) {
      const root = packageRoot(manifest)
      try {
        await expect(new Backends(root, detectTarget()).platform()).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  test("a failure is not cached: once the native files appear, the same instance answers", async () => {
    const root = packageRoot(undefined)
    const backends = new Backends(root, detectTarget())
    try {
      await expect(backends.platform()).rejects.toMatchObject({ code: "NATIVE_FILES_MISSING" })
      // The manifest arrives after the plugin loaded, as when the native build finishes after OpenCode started.
      writeFileSync(join(root, "manifest", "backends.json"), JSON.stringify({ platforms: {} }))
      await expect(backends.platform()).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("the repository's own build names this platform and pins its programs", async () => {
    const { root, entry } = await new Backends(repo, detectTarget()).platform()
    expect(entry).toEqual({ time: { path: "bin/time-keep", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, weather: expect.objectContaining({ path: "bin/weather-signal" }) })
    expect(root).toContain(`opencode-utilities-bin-${detectTarget()}`)
    // The pinned hash is the built file's, so an ensure that never ran cannot pass.
    await expect(new Backends(repo, detectTarget()).executable("time")).resolves.toMatchObject({ path: expect.stringContaining("bin/time-keep") })
  })
})
