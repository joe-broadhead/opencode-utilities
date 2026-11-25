// Packs the package as npm would publish it, installs the tarball into an empty project with scripts disabled, and
// proves the installed files: the manifest, the one self-contained server bundle, no dependencies, and a server entry
// that loads. Loading the bundle in the real OpenCode 2.4.1 host is `plugin-kit check`'s T1.
//
// Run `npm run build` first. PACKED_DIR names a folder with the tarball already packed, as a release does: the test then
// checks that exact file.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"

setDefaultTimeout(300_000)
const repo = fileURLToPath(new URL("../../", import.meta.url))
const NAME = "@we-the-rebel-alliance/utilities-plugin"
const source = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string; capabilities: { plugin: { name: string; host: { opencode: string; tested: string[] } } } }
const installedManifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as Record<string, unknown>

// Never under the real home: OpenCode searches upward for .opencode/ folders.
const realHome = realpathSync(homedir())
const temp = realpathSync(mkdtempSync(join(existsSync("/private/tmp") ? "/private/tmp" : tmpdir(), "utilities-pack-")))
if (temp === realHome || temp.startsWith(realHome + sep)) throw new Error(`refusing to run: the test root ${temp} is inside the home directory`)
const project = join(temp, "project"), installed = join(project, "node_modules", NAME)
interface Packed { filename: string; size: number; files: { path: string }[] }
const PACKED_DIR = process.env.PACKED_DIR
let main: Packed
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

const pack = (): Packed => {
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], repo)) as Packed[]
  if (packed === undefined) throw new Error("npm pack wrote no tarball")
  return packed
}
const existing = (): Packed => {
  const file = join(PACKED_DIR!, `${NAME.replace(/^@/, "").replace("/", "-")}-${source.version}.tgz`)
  if (!existsSync(file)) throw new Error(`PACKED_DIR has no ${file}`)
  const files = run("tar", ["-tzf", file], PACKED_DIR!).split("\n").filter(path => path && !path.endsWith("/")).map(path => ({ path: path.replace(/^package\//, "") }))
  return { filename: file, size: statSync(file).size, files }
}

beforeAll(() => {
  if (!PACKED_DIR && !existsSync(join(repo, "dist/index.js"))) throw new Error("dist/ is missing: run npm run build first")
  main = PACKED_DIR ? existing() : pack()
  const tarball = join(temp, main.filename)
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "pack-probe", private: true }))
  // Offline: the package has no dependencies, and the programs and speech files come from the release on install.
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(temp, "npm-cache"), tarball], project)
})
afterAll(() => { rmSync(temp, { recursive: true, force: true }) })

describe("the tarball", () => {
  test("holds the published files only, under 1 MB", () => {
    const files = main.files.map(file => file.path).sort()
    expect(main.size).toBeLessThan(1_000_000)
    expect(files.filter(file => /\.(?:tsx|jsx|ts)$/.test(file))).toEqual([])
    // The programs and the speech files come from the release: none is packed.
    expect(files.filter(file => /^bin\//.test(file) || /(?:^|\/)(?:time-keep|weather-signal|utilities-speech-[a-z0-9-]+|ggml-[^/]+|kitten[^/]*)$/.test(file))).toEqual([])
    expect(files).toEqual([...files].filter(file =>
      file === "package.json" || file === "dist/index.js" || file === "README.md" || file === "LICENSE" || file === "NOTICE" || file === "CHANGELOG.md" ||
      file.startsWith("assets/") || file.startsWith("skills/") || file.startsWith("manifest/")))
    // Every skill the plugin ships is packed, with its SKILL.md.
    expect(files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file)).length).toBeGreaterThan(0)
  })

  test("has the published manifest: one server entry, no dependencies, the capabilities", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Record<string, unknown>
    expect(manifest).toMatchObject({
      name: NAME,
      version: source.version,
      type: "module",
      exports: { "./server": "./dist/index.js" },
      capabilities: { version: 1, plugin: { name: "utilities", host: { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] } } },
    })
    for (const field of ["workspaces", "dependencies", "peerDependencies", "peerDependenciesMeta", "bundleDependencies", "bundledDependencies", "optionalDependencies", "overrides", "main", "types"]) {
      expect(manifest[field], field).toBeUndefined()
    }
    const capabilities = manifest.capabilities as { accounts?: unknown; sources: unknown[]; actions: unknown[]; events: Record<string, unknown>; methods: Record<string, { class: string; accounts: string }> }
    // No accounts: status is the only method with no account, and none declares one.
    expect(capabilities.accounts).toBeUndefined()
    expect(capabilities.sources).toEqual([]); expect(capabilities.actions).toEqual([])
    expect(Object.keys(capabilities.events)).toEqual(["changed"])
    expect(Object.values(capabilities.methods).every(method => method.accounts === "none")).toBe(true)
    expect(capabilities.methods["status"]).toMatchObject({ class: "read", accounts: "none" })
    expect(manifest["engines"]).toEqual({ node: ">=24" })
  })

  test("dist/ holds exactly index.js, self-contained", () => {
    expect(readdirSync(join(installed, "dist")).sort()).toEqual(["index.js"])
    const scanner = new Bun.Transpiler({ loader: "js" })
    const imports = scanner.scanImports(readFileSync(join(installed, "dist/index.js"), "utf8"))
    expect(imports.filter(i => i.path.startsWith(".") || i.path.startsWith("/")).map(i => `${i.kind} ${i.path}`)).toEqual([])
    expect(imports.filter(i => (i.kind === "dynamic-import" || i.kind === "require-call") && i.path !== "bun:sqlite").map(i => i.path)).toEqual([])
    const host = /^(?:node:|bun:|@opencode\/plugin(?:\/|$))/
    expect(imports.map(i => i.path).filter(path => !host.test(path))).toEqual([])
    // NOTICE names every package the bundle inlines.
    expect(readFileSync(join(installed, "NOTICE"), "utf8")).toContain("## zod 4.6.7 (MIT), in dist/index.js\n")
    expect(existsSync(join(installed, "dist/tui.js"))).toBe(false)
  })

  test("its server entry imports from the empty project with only the host module served", () => {
    const probe = JSON.parse(run(process.execPath, [join(repo, "test/pack/probe.ts"), project], repo)) as { served: string[]; server: { id: string; setup: string; path: string } }
    expect(probe.served).toEqual(["@opencode/plugin"])
    expect(probe.server).toEqual({ id: source.capabilities.plugin.name, setup: "function", path: join(installed, "dist/index.js") })
  })
})

test("ships no program: its release manifest, when it has one, pins the two programs at this tag", () => {
  expect(existsSync(join(installed, "bin"))).toBe(false)
  if (!existsSync(join(installed, "manifest/native.json"))) return
  const manifest = JSON.parse(readFileSync(join(installed, "manifest/native.json"), "utf8")) as { tag: string; modules: Record<string, Record<string, { url: string }>> }
  expect(manifest.tag).toBe(`v${source.version}`)
  expect(Object.keys(manifest.modules).sort()).toEqual(["time-keep", "weather-signal"])
})

test("the manifest in the repository is what the package publishes", () => {
  // The tarball's package.json is the repository's, byte for byte, including capabilities.
  expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))).toEqual(installedManifest)
})
