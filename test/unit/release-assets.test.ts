// The release asset list: every native and speech file is passed to `gh release create` by the exact name both
// manifests pin. A directory or a glob is never used, so `release/native` cannot be uploaded as an asset.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { pinnedNames, pinnedPaths } from "../../scripts/release-assets.mjs"
import { releaseManifestProblems } from "../../scripts/release-manifest.mjs"

// The native manifest is built, not committed. CI always has it; a clean clone without Rust uses this synthetic one for
// the generic checks, and the shipped-name assertion is skipped with the reason below.
const shipped = existsSync("manifest/native.json") ? JSON.parse(readFileSync("manifest/native.json", "utf8")) : undefined
if (shipped === undefined) console.warn("SKIP the shipped native-name assertion: no manifest/native.json. Run npm run native:ensure with Rust 1.96.0; CI and the release always run it.")
const version = "0.0.0"
const synthetic = {
  schema: 1, plugin: "utilities", repository: "we-the-rebel-alliance/utilities-plugin", tag: `v${version}`,
  built: { commit: "0".repeat(40), run: 1, workflow: "native" },
  modules: Object.fromEntries(["time-keep", "weather-signal"].map(module => [module, {
    "linux-x64-gnu": {
      name: `${module}-linux-x64-gnu.gz`,
      url: `https://github.com/we-the-rebel-alliance/utilities-plugin/releases/download/v${version}/${module}-linux-x64-gnu.gz`,
      bytes: 1, sha256: "0".repeat(64),
      executable: { name: module, bytes: 1, sha256: "0".repeat(64) },
    },
  }])),
}
const native = shipped ?? synthetic
const speech = JSON.parse(readFileSync("manifest/speech-assets.json", "utf8"))

const cleanups: string[] = []
afterEach(() => { for (const directory of cleanups.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** A staging directory holding every pinned name, plus whatever else the test adds. */
function staged(extra: readonly string[] = []): string {
  const directory = mkdtempSync(join(tmpdir(), "utilities-release-assets-"))
  cleanups.push(directory)
  for (const name of [...pinnedNames(native, speech), ...extra]) writeFileSync(join(directory, name), "")
  return directory
}

describe("the release asset list", () => {
  test.skipIf(shipped === undefined)("names every pinned native, licence and speech file, exactly", () => {
    expect(pinnedNames(shipped!, speech)).toEqual([
      "time-keep-linux-x64-gnu.gz",
      "weather-signal-linux-x64-gnu.gz",
      "utilities-speech-darwin-arm64",
      "utilities-speech-linux-x64-gnu",
      "utilities-speech-linux-arm64-gnu",
      "ggml-tiny-q5_1.bin",
      "kitten_tts_nano_v0_8.onnx",
      "kitten_tts_nano_v0_8-voices.npz",
      "kitten_tts_nano_v0_8-config.json",
    ])
  })
  test("includes a licence the manifest pins, after the module files", () => {
    const withLicence = { ...native, licences: [{ name: "NOTICE" }] }
    expect(pinnedNames(withLicence, speech)).toContain("NOTICE")
    expect(pinnedNames(withLicence, speech).indexOf("NOTICE")).toBe(2)
  })
  test("returns a path for each staged file and refuses an unnamed extra", () => {
    const directory = staged()
    const paths = pinnedPaths(directory, pinnedNames(native, speech))
    expect(paths).toHaveLength(9)
    expect(paths[0]).toBe(join(directory, "time-keep-linux-x64-gnu.gz"))
    const withExtra = staged(["dist-index.js"])
    expect(() => pinnedPaths(withExtra, pinnedNames(native, speech))).toThrow(/files no manifest names: dist-index\.js/)
  })
  test("refuses a missing staged file, a duplicate name and a name with a path", () => {
    const directory = staged()
    rmSync(join(directory, "ggml-tiny-q5_1.bin"))
    expect(() => pinnedPaths(directory, pinnedNames(native, speech))).toThrow(/is not a staged file/)
    expect(() => pinnedNames({ modules: { a: { p: { name: "same" } }, b: { p: { name: "same" } } } })).toThrow(/pin same twice/)
    expect(() => pinnedNames({ modules: { a: { p: { name: "nested/file" } } } })).toThrow(/plain file name/)
  })
})

describe("the candidate release manifest", () => {
  const commit = "0".repeat(40)
  const built = { ...native, built: { ...native.built, run: 1 } }
  test("accepts the manifest the native workflow built for this tag and commit", () => {
    expect(releaseManifestProblems(built, { tag: native.tag, commit, repository: native.repository })).toEqual([])
  })
  test("refuses another tag, another commit, a zero run and an empty module set", () => {
    expect(releaseManifestProblems(built, { tag: "v9.9.9", commit, repository: native.repository })).toContain("tag is v0.0.0; the release tag is v9.9.9")
    expect(releaseManifestProblems(built, { tag: native.tag, commit: "1".repeat(40), repository: native.repository }).some(problem => problem.includes("built.commit"))).toBe(true)
    const zero = JSON.parse(JSON.stringify(built)); zero.built.run = 0
    expect(releaseManifestProblems(zero, { tag: native.tag, commit, repository: native.repository })).toContain("built.run must be a positive run id")
    const empty = JSON.parse(JSON.stringify(built)); empty.modules = {}
    expect(releaseManifestProblems(empty, { tag: native.tag, commit, repository: native.repository })).toContain("modules is empty")
  })
})
