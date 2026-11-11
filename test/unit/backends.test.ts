// The time and weather programs are downloaded on first use, pinned by manifest/native.json. A checkout with no
// release manifest names no program and says so: NATIVE_FILES_MISSING, not a clash with the contract.
import { describe, expect, test } from "vitest"
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { NativeBinaries, detectTarget } from "../../src/domain/backends.js"
import { PLATFORMS } from "../../src/domain/contract.js"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const TEMP = existsSync("/private/tmp") ? "/private/tmp" : "/tmp"
const target = detectTarget()
// A platform other than this one. A manifest for it names nothing here, whatever platform the runner is on (CI runs linux-x64-gnu).
const other = Object.keys(PLATFORMS).find(platform => platform !== target)
if (other === undefined) throw new Error("PLATFORMS names only this platform")
// The manifest this build wrote (npm run native:ensure), which the checks below read rather than invent.
const built = (): { tag: string; modules: Record<string, Record<string, { executable: { sha256: string } }>> } =>
  JSON.parse(readFileSync(join(repo, "manifest/native.json"), "utf8"))

/** A package root holding one manifest file (or none), and nothing else. Its cache starts empty. */
function packageRoot(manifest: string | undefined): { root: string; cache: string } {
  const root = realpathSync(mkdtempSync(join(TEMP, "utilities-native-")))
  mkdirSync(join(root, "manifest"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "native-test", version: "0.0.0" }))
  if (manifest !== undefined) writeFileSync(join(root, "manifest", "native.json"), manifest)
  return { root, cache: join(root, "cache") }
}

/** The build's manifest with this platform's entries moved to another platform: valid, and names nothing here. */
function manifestFor(platform: string): string {
  const release = built()
  const modules = Object.fromEntries(Object.entries(release.modules).map(([module, platforms]) => [module, { [platform]: platforms[target] }]))
  return JSON.stringify({ ...release, modules })
}

describe("the release programs", () => {
  test("a checkout with no manifest says the native files are missing, not that the contract clashed", async () => {
    const { root, cache } = packageRoot(undefined)
    try {
      await expect(new NativeBinaries({ packageRoot: root, cacheRoot: cache, target }).platform()).rejects.toMatchObject({ code: "NATIVE_FILES_MISSING" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a manifest that is not the one this version writes is a contract mismatch", async () => {
    for (const manifest of ["{", JSON.stringify({ schema: 1, modules: { "time-keep": { [target]: { name: "/etc/passwd" } } } })]) {
      const { root, cache } = packageRoot(manifest)
      try {
        await expect(new NativeBinaries({ packageRoot: root, cacheRoot: cache, target }).platform()).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  test("a failure is not cached: once the manifest appears, the same instance answers", async () => {
    const { root, cache } = packageRoot(undefined)
    const binaries = new NativeBinaries({ packageRoot: root, cacheRoot: cache, target })
    try {
      await expect(binaries.platform()).rejects.toMatchObject({ code: "NATIVE_FILES_MISSING" })
      // The manifest arrives after the plugin loaded, as when the native build finishes after OpenCode started.
      writeFileSync(join(root, "manifest", "native.json"), manifestFor(other))
      await expect(binaries.platform()).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("the repository's own build names this platform, and an empty cache has no program to run", async () => {
    const { root, cache } = packageRoot(undefined)
    try {
      const binaries = new NativeBinaries({ packageRoot: repo, cacheRoot: cache, target })
      await expect(binaries.platform()).resolves.toBeUndefined()
      // Nothing is downloaded by looking: an empty cache answers undefined, and the caller asks before any install.
      await expect(binaries.cached("time-keep")).resolves.toBeUndefined()
      await expect(binaries.cached("weather-signal")).resolves.toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a cached program that holds the pinned bytes is used as it is; a link to it is UNSAFE_PATH", async () => {
    const { root, cache } = packageRoot(manifestFor(target))
    try {
      const tag = built().tag, source = join(repo, "build/native", target, "time-keep")
      const cached = join(cache, "native", tag, "time-keep", target, "time-keep")
      mkdirSync(join(cache, "native", tag, "time-keep", target), { recursive: true })
      copyFileSync(source, cached)
      const binaries = new NativeBinaries({ packageRoot: root, cacheRoot: cache, target })
      await expect(binaries.cached("time-keep")).resolves.toEqual({ path: cached, sha256: built().modules["time-keep"]![target]!.executable.sha256 })
      // A link is never followed to a run: it is refused by name, whatever it points at.
      rmSync(cached); symlinkSync(source, cached)
      expect(lstatSync(cached).isSymbolicLink()).toBe(true)
      await expect(binaries.cached("time-keep")).rejects.toMatchObject({ code: "UNSAFE_PATH" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
