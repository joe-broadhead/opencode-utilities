// Packs the package as npm would publish it, installs the tarball into an empty project with scripts disabled,
// imports its entries, and loads it on each tested stock OpenCode release (TESTED_HOSTS: 2.2.3, 2.2.4, 2.2.5 and 2.2.6).
// Run `npm run build` first. OPENCODE_BIN_2_2_3, OPENCODE_BIN_2_2_4 and OPENCODE_BIN_2_2_5 name the stock
// `opencode` binaries when set. When unset, each release is installed into this test's temp project with
// --ignore-scripts, once per version.
// PACKED_DIR names a folder of tarballs that are already packed, as release.yml does: the test then checks the
// main tarball and this platform's tarball from there, the exact files that will be published.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, homedir, platform, tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_ASK, MODULES, PLATFORMS, PLUGIN_ID } from "../../src/domain/contract.js"
import { detectTarget, isPlatform } from "../../src/domain/backends.js"
import { HOST_RANGE, TESTED_HOSTS } from "../../src/host/versions.js"
import { SCRIPT_TOOLS } from "../../src/host/scripting.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { wav } from "../fixtures.js"

setDefaultTimeout(300_000)
const repo = fileURLToPath(new URL("../../", import.meta.url))
const NAME = "@joe-broadhead/opencode-utilities"
const VERSIONS = TESTED_HOSTS
const source = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }
const target = detectTarget()
const platformPackage = isPlatform(target) ? PLATFORMS[target].package : undefined
// Platform packages are npm workspaces in npm/<name without scope>/. Once any exists, this platform's must too.
const workspaces = existsSync(join(repo, "npm")) ? readdirSync(join(repo, "npm")).filter(dir => existsSync(join(repo, "npm", dir, "package.json"))) : []
const platformDir = platformPackage && workspaces.length > 0 ? join(repo, "npm", platformPackage.split("/")[1]!) : undefined
// A speech engine is built where ONNX Runtime ships a static library (native/onnx-provenance.json): every target but
// x86_64-apple-darwin, so darwin-x64 has no speech tools.
const onnx = JSON.parse(readFileSync(join(repo, "native/onnx-provenance.json"), "utf8")) as { distributions: Record<string, unknown> }
const speechEngine = isPlatform(target) && Boolean(onnx.distributions[PLATFORMS[target].triple])

// Never under the real home: OpenCode searches upward for .opencode/ folders. Every server also gets its own port.
const realHome = realpathSync(homedir())
const temp = realpathSync(mkdtempSync(join(existsSync("/private/tmp") ? "/private/tmp" : tmpdir(), "utilities-pack-")))
if (temp === realHome || temp.startsWith(realHome + sep)) throw new Error(`refusing to run: the test root ${temp} is inside the home directory`)
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
    // The server part at "." and "./tui" (the TUI imports the RPC contract from its own bundle), plus the three icons
    // the host and Jelly read. Nothing else, and no ./rpc.
    expect(manifest.exports).toEqual({
      ".": "./dist/index.js",
      "./tui": "./dist/tui.js",
      "./icon.svg": "./assets/icon.svg",
      "./icon-128.png": "./assets/icon-128.png",
      "./icon-256.png": "./assets/icon-256.png",
    })
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
  expect(probe.tui).toEqual({ id: "utilities.local.tui", setup: "function" })
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
    expect(view.host).toEqual({ version, range: HOST_RANGE, tested: true })
    // `locked`, defined only in config, missed the block and denies only the time tools, so weather would run there unasked.
    expect(view).toMatchObject({ state: "ready", unguardedAgents: ["locked"] })
    expect(view.nextStep).toBe("Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools.")
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

  // The tools RPC on the same server: a script calls the tools that change nothing, as a session and its agent.
  describe(`the tools RPC ${TOOLS_RPC_ID}`, () => {
    const sessions: Record<string, string> = {}
    const call = (session: string, method: string, input: unknown) => script(host, method, { sessionID: sessions[session] ?? session, input })
    beforeAll(async () => {
      const create = async (body: object) => ((await host.api("POST", "/api/session", body)).data as { data: { id: string } }).data.id
      sessions.build = await create({ agent: "build" })
      sessions.locked = await create({ agent: "locked" })
      sessions.agentless = await create({})
      // Session rules come after the agent's: one narrows build, one reopens a tool for locked, one allows everything.
      sessions.narrow = await create({ agent: "build", permissions: [rule("utilities_time_now", "deny")] })
      sessions.reopen = await create({ agent: "locked", permissions: [rule("utilities_time_now", "allow")] })
      sessions.allowed = await create({ agent: "build", permissions: [rule("utilities_*", "allow")] })
    })

    test("describes every tool with its class; a write is refused before it runs unless the session allows it", async () => {
      const { value } = await script(host, "describe", {})
      expect(value.methods.map((method: { name: string }) => method.name)).toEqual([...SCRIPT_TOOLS])
      for (const method of value.methods) expect(method).toMatchObject({ kind: "plugin", action: `utilities_${method.name}` })
      if (platformDir) for (const method of value.methods.filter((m: { name: string }) => /^(?:time|timer|weather)_/.test(m.name))) expect(method).toMatchObject({ available: true })
      expect(Object.fromEntries(value.methods.map((method: { name: string; class: string }) => [method.name, method.class]))).toMatchObject({
        time_now: "read", timer_set: "write", timer_delete: "write", speech_synthesize: "export",
      })
      for (const name of ["timer_set", "timer_delete", "speech_synthesize"])
        expect(await call("build", name, { name: "review", deadline: "2026-11-02T09:00:00Z", text: "hello" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("allowed", "unknown_tool", {})).toMatchObject({ type: "rpc.method_not_found" })
    })

    test("runs a read with the real time program as the session's agent, with no model turn", async () => {
      const result = await call("build", "time_now", { timezones: ["UTC"] })
      if (!platformDir) return void expect(result).toMatchObject({ type: "failed", code: "PLATFORM_PACKAGE_MISSING" })
      expect(result.value).toMatchObject({ format: "rfc3339", times: [{ timezone: "UTC", utc_offset: "+00:00" }] })
      const session = (await host.api("GET", `/api/session/${sessions.build}`)).data as { data: { tokens: { input: number; output: number } } }
      expect(session.data.tokens).toMatchObject({ input: 0, output: 0 })
    })

    test("refuses a tool the agent hides, and applies the session's rules after the agent's", async () => {
      expect(await call("locked", "time_now", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("narrow", "time_now", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("narrow", "time_zones", { region: "Europe" })).not.toMatchObject({ code: "PERMISSION_DENIED" })
      expect(await call("reopen", "time_now", {})).not.toMatchObject({ code: "PERMISSION_DENIED" })
      expect(await call("reopen", "time_zones", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    })

    test("refuses the weather ask, and the speech download ask, at once with no approval prompt left waiting", async () => {
      const asks = ["weather_current", ...speechEngine ? ["speech_transcribe"] : []]
      for (const method of asks) {
        const started = Date.now()
        const result = await call("build", method, method === "weather_current" ? { location: "Amsterdam" } : { path: "clip.wav" })
        expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(result.message).toMatch(/cannot answer/)
        expect(Date.now() - started).toBeLessThan(5000)
        // UTIL-6: the refusal names the ask that was refused, the download, not the transcription itself.
        if (method === "speech_transcribe") {
          expect(result.message).toContain("needs utilities_speech_download, which was refused")
          expect(result.next).toStartWith("Add an allow rule for utilities_speech_download")
        }
      }
      const pending = (await host.api("GET", "/api/permission/request")).data as { data: unknown[] }
      expect(pending.data.filter(request => JSON.stringify(request).includes(sessions.build!))).toEqual([])
    })

    test("names an unknown session and a session without an agent, checks the input, and refuses a bad envelope", async () => {
      expect(await call("ses_does_not_exist", "time_now", {})).toMatchObject({ type: "failed", code: "SESSION_UNKNOWN" })
      expect(await call("agentless", "time_now", {})).toMatchObject({ type: "failed", code: "SESSION_AGENT_REQUIRED" })
      expect(await call("build", "time_now", { timezones: "UTC", extra: 1 })).toMatchObject({ type: "failed", code: "INPUT_INVALID" })
      for (const envelope of [{ sessionID: sessions.build, input: {}, extra: true }, { input: {} }, { sessionID: sessions.build }])
        expect(await script(host, "time_now", envelope)).toMatchObject({ type: "rpc.invalid_input" })
    })
  })
})

const rule = (action: string, effect: "allow" | "deny" | "ask") => ({ action, resource: "*", effect })

/** A tools RPC call's output as `{ value }`, or its error's `{ type, code, message }`. */
async function script(host: { api: (method: string, path: string, body?: unknown) => Promise<{ status: number; data: unknown }> }, method: string, input: unknown): Promise<Record<string, any>> {
  const { status, data } = await host.api("POST", `/api/rpc/${TOOLS_RPC_ID}/${method}`, { input })
  const body = data as Record<string, any>
  if (status === 200) return { value: body.output }
  return { type: body.type ?? body._tag, code: body.data?.code, next: body.data?.next, message: String(body.message ?? data) }
}

/** The stock CLI for `version`: the OPENCODE_BIN_* path when set, otherwise the npm release with scripts off. Memoised: a second install would fail on its folder (EEXIST). */
const binaries = new Map<string, string>()
function stockBinary(version: string) {
  let binary = binaries.get(version)
  if (!binary) { binary = installStock(version); binaries.set(version, binary) }
  return binary
}
function installStock(version: string) {
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
  // `locked`, an agent defined only in config, hides the time tools: the tools RPC tests use it.
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: [installed], agents: { locked: { mode: "primary", permissions: [rule("utilities_time_*", "deny")] } } }))
  // A valid WAV in the project: a transcription is checked before it asks to download the speech files.
  writeFileSync(join(directory, "clip.wav"), wav())
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
