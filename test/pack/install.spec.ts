// Packs the package as npm would publish it, installs the tarball into an empty project with scripts disabled,
// imports its entries, and loads it on stock OpenCode 2.2.3 and 2.2.4. Run `npm run build` first.
// OPENCODE_BIN_2_2_3 and OPENCODE_BIN_2_2_4 name the stock `opencode` binaries when set. When unset, each
// release is installed into this test's temp project with --ignore-scripts. That is the CI path.
// PACKED_DIR names a folder of tarballs that are already packed, as release.yml does: the test then checks the
// main tarball and this platform's tarball from there, the exact files that will be published.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform, tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_ASK, MODULES, PLATFORMS, PLUGIN_ID } from "../../src/domain/contract.js"
import { detectTarget, isPlatform } from "../../src/domain/backends.js"
import { HOST_RANGE } from "../../src/host/compat.js"

setDefaultTimeout(300_000)
const repo = fileURLToPath(new URL("../../", import.meta.url))
const NAME = "@joe-broadhead/opencode-utilities"
const VERSIONS = ["2.2.3", "2.2.4"] as const
const source = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }
const target = detectTarget()
const platformPackage = isPlatform(target) ? PLATFORMS[target].package : undefined
// Platform packages are npm workspaces in npm/<name without scope>/. Once any exists, this platform's must too.
const workspaces = existsSync(join(repo, "npm")) ? readdirSync(join(repo, "npm")).filter(dir => existsSync(join(repo, "npm", dir, "package.json"))) : []
const platformDir = platformPackage && workspaces.length > 0 ? join(repo, "npm", platformPackage.split("/")[1]!) : undefined
// A speech engine is built where ONNX Runtime ships a static library (native/onnx-provenance.json): every target but
// x86_64-apple-darwin, so darwin-x64 has text cleanup but no transcription or synthesis.
const TRIPLES = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin", "linux-x64-gnu": "x86_64-unknown-linux-gnu", "linux-arm64-gnu": "aarch64-unknown-linux-gnu" } as const
const onnx = JSON.parse(readFileSync(join(repo, "native/onnx-provenance.json"), "utf8")) as { distributions: Record<string, unknown> }
const speechEngine = isPlatform(target) && Boolean(onnx.distributions[TRIPLES[target]])

const temp = realpathSync(mkdtempSync(join(tmpdir(), "utilities-pack-")))
const project = join(temp, "project"), installed = join(project, "node_modules", NAME)
interface Packed { filename: string; size: number; files: { path: string }[] }
const PACKED_DIR = process.env.PACKED_DIR
let main: Packed
const servers = new Set<ChildProcess>()

const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
// Packed as release.yml packs them: the main package without `workspaces`, platform packages with os, cpu and libc.
const pack = (dir: string) => (JSON.parse(run(process.execPath, [join(repo, "scripts/pack.mjs"), dir, temp], repo)) as Packed[])[0]!

/** A tarball packed earlier, described the way `npm pack --json` describes one. */
const existing = (name: string): Packed => {
  const file = join(PACKED_DIR!, `${name.replace(/^@/, "").replace("/", "-")}-${source.version}.tgz`)
  if (!existsSync(file)) throw new Error(`PACKED_DIR has no ${file}`)
  const files = run("tar", ["-tzf", file], PACKED_DIR!).split("\n").filter(path => path && !path.endsWith("/")).map(path => ({ path: path.replace(/^package\//, "") }))
  return { filename: file, size: statSync(file).size, files }
}

beforeAll(() => {
  if (!PACKED_DIR && !existsSync(join(repo, "dist/index.js"))) throw new Error("dist/ is missing: run npm run build first")
  // No prepare or prepack script exists (check-forbidden), so packing never rebuilds dist/.
  main = PACKED_DIR ? existing(NAME) : pack(repo)
  // npm pack reports a file name in temp; a tarball from PACKED_DIR has an absolute path.
  const tarballs = [resolve(temp, main.filename)]
  if (platformDir) {
    if (!existsSync(join(platformDir, "package.json"))) throw new Error(`npm/ has platform packages but none for ${target} (${platformPackage})`)
    tarballs.push(resolve(temp, PACKED_DIR ? existing(platformPackage!).filename : pack(platformDir).filename))
  }
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "pack-probe", private: true }))
  // Offline: the main package has no dependencies, and optional platform packages that are not given are skipped.
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(temp, "npm-cache"), ...tarballs], project)
})

afterAll(async () => {
  await Promise.all([...servers].map(stop))
  rmSync(temp, { recursive: true, force: true })
})

describe("the tarball", () => {
  test("holds the whitelisted files only, under 1 MB", () => {
    const files = main.files.map(file => file.path)
    expect(main.size).toBeLessThan(1_000_000)
    // No TypeScript, JSX or declaration files: nothing consumes plugin types.
    expect(files.filter(file => /\.(?:tsx|jsx|ts)$/.test(file))).toEqual([])
    expect(files.sort()).toMatchSnapshot()
  })

  test("has the published manifest: no dependencies or peers, the tested host range, and the platform packages", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Record<string, unknown>
    // Only release.yml checks "private"; this test passes with or without it.
    expect(manifest).toMatchObject({ name: NAME, version: source.version, type: "module", opencode: { host: HOST_RANGE } })
    for (const field of ["workspaces", "dependencies", "peerDependencies", "peerDependenciesMeta", "bundleDependencies", "bundledDependencies", "overrides", "engines"]) expect(manifest[field]).toBeUndefined()
    expect(manifest.optionalDependencies).toEqual(Object.fromEntries(Object.values(PLATFORMS).map(p => [p.package, source.version])))
    // Only the server part at "." and "./tui". The TUI imports the RPC contract from its own bundle.
    expect(manifest.exports).toEqual({ ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    expect(manifest.main).toBeUndefined()
    expect(manifest.types).toBeUndefined()
  })

  // Hot-reload regression: OpenCode reloads an updated plugin in place but keeps the module records it already holds
  // for unchanged paths. A new entry that imported a sibling file could get the stale old one. So dist/ holds only the
  // two entries, and neither imports, dynamically imports or requires any relative path.
  test("dist/ holds exactly index.js and tui.js, each self-contained", () => {
    expect(readdirSync(join(installed, "dist")).sort()).toEqual(["index.js", "tui.js"])
    const scanner = new Bun.Transpiler({ loader: "js" })
    for (const entry of ["index.js", "tui.js"]) {
      const imports = scanner.scanImports(readFileSync(join(installed, "dist", entry), "utf8"))
      expect(imports.filter(i => i.path.startsWith(".") || i.path.startsWith("/")).map(i => `${i.kind} ${i.path}`), entry).toEqual([])
      expect(imports.filter(i => i.kind === "dynamic-import" || i.kind === "require-call").map(i => i.path), entry).toEqual([])
      const host = /^(?:node:|@opencode\/plugin(?:\/|$)|@opentui\/|solid-js(?:\/|$))/
      expect(imports.map(i => i.path).filter(path => !host.test(path)), entry).toEqual([])
    }
    expect(scanner.scanImports(readFileSync(join(installed, "dist/tui.js"), "utf8")).map(i => i.path)).toContain("@opentui/solid")
  })

  test("dist/tui.js carries no zod and stays under 30 KB: the RPC contract is plain JSON Schema", () => {
    const tui = readFileSync(join(installed, "dist/tui.js"), "utf8")
    expect(Buffer.byteLength(tui)).toBeLessThan(30_000)
    expect(tui).not.toMatch(/node_modules\/zod\/|\bZodType\b|\$ZodError|from "zod"/)
    // NOTICE names exactly the bundles each package is in, and zod is in the server bundle only.
    expect(readFileSync(join(installed, "NOTICE"), "utf8")).toContain("## zod 4.6.7 (MIT), in dist/index.js\n")
  })
})

test("its entries import from the empty project with only host-provided modules served", () => {
  const probe = JSON.parse(run(process.execPath, [join(repo, "test/pack/probe.ts"), project], repo)) as { served: string[]; server: { id: string; setup: string; path: string }; tui: { id: string; setup: string } }
  expect(probe.served).toEqual(["@opencode/plugin", "@opencode/plugin/promise/tool", "@opencode/plugin/rpc", "@opentui/solid", "solid-js"])
  expect(probe.server).toEqual({ id: PLUGIN_ID, setup: "function", path: join(installed, "dist/index.js") })
  expect(probe.tui).toEqual({ id: "utilities.tools.tui", setup: "function" })
})

test("the platform package installs beside it with the binaries manifest/backends.json pins", () => {
  expect(platformPackage).toBeDefined()
  if (!platformDir) {
    // Until the platform packages exist, npm skips the optional dependency and the plugin still installs.
    expect(workspaces).toEqual([])
    expect(existsSync(join(project, "node_modules", platformPackage!))).toBe(false)
    return
  }
  const probe = JSON.parse(run(process.execPath, [join(repo, "test/pack/probe.ts"), project, platformPackage!], repo)) as { platform: string }
  expect(probe.platform).toBe(join(project, "node_modules", platformPackage!))
  const manifest = JSON.parse(readFileSync(join(installed, "manifest/backends.json"), "utf8")) as { platforms: Record<string, Record<string, { path: string; sha256: string }>> }
  const binaries = Object.entries(manifest.platforms[target] ?? {})
  expect(binaries.map(([module]) => module).sort()).toEqual(["time", "weather"])
  for (const [, { path, sha256 }] of binaries) expect(createHash("sha256").update(readFileSync(join(probe.platform, path))).digest("hex")).toBe(sha256)
  const { os, cpu, libc } = JSON.parse(readFileSync(join(probe.platform, "package.json"), "utf8")) as Record<string, unknown>
  const expected = PLATFORMS[target as keyof typeof PLATFORMS]
  expect({ os, cpu, libc }).toEqual({ os: [expected.os], cpu: [expected.cpu], libc: "libc" in expected ? [expected.libc] : undefined })
})

for (const version of VERSIONS) describe(`stock OpenCode ${version}`, () => {
  let host: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => { host = await serve(version, stockBinary(version)) })
  afterAll(async () => { if (host) await stop(host.child) })

  test("loads the installed package as an active plugin with its server and TUI parts", () => {
    // No ./rpc export, so the host lists no rpc feature; the server still registers the status method, tested below.
    expect(host.plugin).toMatchObject({ id: PLUGIN_ID, source: { type: "local", path: installed }, features: { server: true, tui: true }, state: { status: "active" } })
    expect((host.plugin as { features?: { rpc?: boolean } }).features?.rpc).toBeUndefined()
  })

  test("answers the status RPC with its version, the host check and every module", async () => {
    const response = await host.api("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })
    expect(response.status).toBe(200)
    const view = (response.data as { output: Record<string, any> }).output
    expect(view.version).toBe(source.version)
    expect(view.host).toEqual({ required: HOST_RANGE, found: version, availability: "AVAILABLE" })
    expect(view.platform).toMatchObject({ target, ...platformPackage ? { package: platformPackage } : {} })
    expect(Object.keys(view.modules).sort()).toEqual([...MODULES].sort())
    expect(view.permissions.askByDefault).toEqual([...DEFAULT_ASK])
  })

  test("finds the platform package, manifest/ and the speech cache from the installed bundle", async () => {
    const view = ((await host.api("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })).data as { output: Record<string, any> }).output
    if (!platformDir) return
    // manifest/backends.json, resolved from dist/index.js's package root, pins the platform package's verified binaries.
    expect(view.platform.availability).toBe("AVAILABLE")
    expect([view.modules.time.availability, view.modules.weather.availability]).toEqual(["AVAILABLE", "AVAILABLE"])
    // manifest/speech-assets.json is read from the same root and has an engine exactly where one is built.
    const speech = JSON.parse(readFileSync(join(installed, "manifest/speech-assets.json"), "utf8")) as { engines: Record<string, unknown> }
    expect(Boolean(speech.engines[target])).toBe(speechEngine)
    if (speechEngine) expect(view.speech.assets.length).toBeGreaterThan(0)
    else {
      // With no engine for this platform, speech is unsupported and no speech files are offered for download.
      expect(view.modules.speech.availability).toBe("UNSUPPORTED_PLATFORM")
      expect(view.speech.assets).toEqual([])
    }
    // The cache is under the isolated XDG cache home.
    expect(view.speech.cacheDirectory).toBe(join(host.home, ".cache", "opencode-utilities"))
  })

  test("registers its skills, read from the installed skills/ folder: speech only where an engine is built", async () => {
    const response = await host.api("GET", "/api/skill")
    const list = Array.isArray(response.data) ? response.data : (response.data as { data?: unknown[] }).data ?? []
    const ids = (list as { id?: string; name?: string }[]).map(skill => skill.id ?? skill.name ?? "").filter(id => id.startsWith("utilities-")).sort()
    expect(ids).toEqual([...speechEngine ? ["utilities-speech"] : [], "utilities-time", "utilities-weather"])
  })

  test("inserts the default ask rules after the build agent's base allow", async () => {
    const response = await host.api("GET", "/api/agent")
    const list = Array.isArray(response.data) ? response.data : (response.data as { data?: unknown[] }).data ?? []
    const build = (list as { id: string; permissions: { action: string; resource: string; effect: string }[] }[]).find(agent => agent.id === "build")
    expect(build).toBeDefined()
    const base = build!.permissions.findIndex(rule => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
    expect(base).toBeGreaterThanOrEqual(0)
    expect(build!.permissions.slice(base + 1, base + 1 + DEFAULT_ASK.length)).toEqual([...DEFAULT_ASK].map(action => ({ action, resource: "*", effect: "ask" })))
  })
})

/** The stock CLI for `version`: the OPENCODE_BIN_* path when set, otherwise the npm release with scripts off. */
function stockBinary(version: string) {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) {
    if (!existsSync(given)) throw new Error(`OPENCODE_BIN_${version.replaceAll(".", "_")} does not exist: ${given}`)
    return given
  }
  // Its own package.json, and npm's cwd set to it: npm walks up from a folder that has none.
  const dir = join(temp, `opencode-${version}`)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `utilities-pack-opencode-${version}`, private: true }))
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@opencode/cli@${version}`], dir)
  const binary = join(dir, "node_modules", "@opencode", `cli-${platform()}-${arch()}`, "bin", "opencode")
  if (!existsSync(binary)) throw new Error(`@opencode/cli@${version} has no binary for ${platform()}-${arch()}`)
  return binary
}

/** Starts `opencode serve` on its own port with an isolated home and a project that lists the installed package. */
async function serve(version: string, binary: string) {
  const root = join(temp, `host-${version}`)
  const home = join(root, "home"), directory = join(root, "project"), tmp = join(root, "tmp")
  for (const dir of [join(home, ".config"), join(home, ".local/share"), join(home, ".cache"), join(home, ".local/state"), directory, tmp]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: [installed] }))
  const password = randomBytes(18).toString("base64url"), port = await freePort()
  const env = {
    HOME: home, OPENCODE_TEST_HOME: home, TMPDIR: tmp,
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CACHE_HOME: join(home, ".cache"), XDG_STATE_HOME: join(home, ".local/state"),
    PATH: "/usr/bin:/bin", OPENCODE_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_FREE_MODELS: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_FILEWATCHER: "1",
    // A dead proxy: anything that leaves loopback fails instead of reaching a real service.
    HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
  }
  expect(execFileSync(binary, ["--version"], { env, cwd: directory, encoding: "utf8" })).toContain(version)
  const listed = execFileSync(binary, ["debug", "paths"], { env, cwd: directory, encoding: "utf8" }).trim().split("\n").flatMap(line => {
    const value = line.trim().split(/\s+/).slice(1).join(" ")
    return value ? [value] : []
  })
  expect(listed.length).toBeGreaterThanOrEqual(8)
  expect(listed.filter(path => !path.startsWith(root + sep))).toEqual([])
  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { cwd: directory, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  servers.add(child)
  let log = ""
  const keep = (chunk: Buffer) => { log = (log + chunk.toString("utf8")).slice(-8000) }
  child.stdout!.on("data", keep)
  child.stderr!.on("data", keep)
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const api = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, ...body === undefined ? {} : { body: JSON.stringify(body) } })
    const text = await response.text()
    let data: unknown = text
    try { data = JSON.parse(text) } catch {}
    return { status: response.status, data }
  }
  // Plugins load on the location's first request; `plugin list` would not wait for that.
  const deadline = Date.now() + 240_000
  type Info = { id: string; state?: { status: string; error?: string } }
  let plugin: Info | undefined
  while (!plugin && Date.now() < deadline && child.exitCode === null) {
    const response = await api("GET", "/api/plugin").catch(() => undefined)
    const list = Array.isArray(response?.data) ? response.data : (response?.data as { data?: unknown[] } | undefined)?.data ?? []
    plugin = (list as Info[]).find(entry => entry.id === PLUGIN_ID)
    if (!plugin) await Bun.sleep(500)
  }
  if (!plugin) throw new Error(`OpenCode ${version} did not list ${PLUGIN_ID} (exit ${child.exitCode}). Server log:\n${log}`)
  if (plugin.state?.status !== "active") throw new Error(`${PLUGIN_ID} did not load on OpenCode ${version}: ${JSON.stringify(plugin.state)}. Server log:\n${log}`)
  return { child, plugin, api, home }
}

async function stop(child: ChildProcess) {
  servers.delete(child)
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once("exit", resolve))
  try { process.kill(-child.pid!, "SIGTERM") } catch {}
  if (await Promise.race([exited.then(() => true), Bun.sleep(10_000).then(() => false)])) return
  try { process.kill(-child.pid!, "SIGKILL") } catch {}
  await exited
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}
