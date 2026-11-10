// Packs the package as npm would publish it, installs the tarball into an empty project with scripts disabled,
// imports its entries, and loads it on each tested stock OpenCode release (TESTED_HOSTS: 2.2.3, 2.2.4, 2.2.5 and 2.2.6).
// Run `npm run build` first. OPENCODE_BIN_2_2_3, OPENCODE_BIN_2_2_4 and OPENCODE_BIN_2_2_5 name the stock
// `opencode` binaries when set. When unset, each release is installed into this test's temp project with
// --ignore-scripts, once per version.
// PACKED_DIR names a folder with the main tarball already packed, as release.yml does: the test then checks the exact
// file that will be published. No program is needed here: the package carries none, and the status reports each program as
// not installed, with its next step. The tool runs that need a program are in test/host, which runs after native:ensure.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, homedir, platform, tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_ASK, READ_ACTIONS, MODULES, PLATFORMS, PLUGIN_ID } from "../../src/domain/contract.js"
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
// Packed as release.yml packs it: the main package without `workspaces`.
const pack = (dir: string) => (JSON.parse(run(process.execPath, [join(repo, "scripts/pack.mjs"), dir, temp, "--without-native-manifest"], repo)) as Packed[])[0]!

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
  const tarball = resolve(temp, main.filename)
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "pack-probe", private: true }))
  // Offline: the main package has no dependencies and carries no program: the release copies come on first use.
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(temp, "npm-cache"), tarball], project)
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
    // The programs and the speech files come from the release on first use: none is packed.
    expect(files.filter(file => /^bin\//.test(file) || /(?:^|\/)(?:time-keep|weather-signal|utilities-speech-[a-z0-9-]+|ggml-[^/]+|kitten[^/]*)$/.test(file))).toEqual([])
    // manifest/native.json is written by the native step, so it is in the tarball exactly when the checkout has it.
    expect(files.includes("manifest/native.json")).toBe(existsSync(join(repo, "manifest/native.json")))
    expect(files.filter(file => file !== "manifest/native.json").sort()).toMatchSnapshot()
  })

  test("has the published manifest: no dependencies, peers or optional packages, and the tested host range", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Record<string, unknown>
    // Only release.yml checks "private"; this test passes with or without it.
    expect(manifest).toMatchObject({ name: NAME, version: source.version, type: "module", opencode: { host: HOST_RANGE } })
    for (const field of ["workspaces", "dependencies", "peerDependencies", "peerDependenciesMeta", "bundleDependencies", "bundledDependencies", "overrides", "engines"]) expect(manifest[field]).toBeUndefined()
    expect(manifest.optionalDependencies).toBeUndefined()
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

test("ships no program: its release manifest, when it has one, pins the two programs at this tag", () => {
  expect(existsSync(join(installed, "bin"))).toBe(false)
  // A checkout's package has no manifest/native.json, so status reports the programs NATIVE_FILES_MISSING (tested below).
  // A release commit carries one, and then it must pin both programs at this tag.
  if (!existsSync(join(installed, "manifest/native.json"))) return
  const manifest = JSON.parse(readFileSync(join(installed, "manifest/native.json"), "utf8")) as { tag: string; modules: Record<string, Record<string, { url: string }>> }
  expect(manifest.tag).toBe(`v${source.version}`)
  expect(Object.keys(manifest.modules).sort()).toEqual(["time-keep", "weather-signal"])
  for (const module of ["time-keep", "weather-signal"]) {
    expect(manifest.modules[module]?.[target]?.url).toBe(`https://github.com/joe-broadhead/opencode-utilities/releases/download/v${source.version}/${module}-${target}.gz`)
  }
})

for (const version of VERSIONS) describe(`stock OpenCode ${version}`, () => {
  let host: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    host = await serve(version, stockBinary(version))
    console.log(`stock OpenCode ${version}: started`)
  })
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
    // No program is installed, so the first next step is the program download; the rules step follows it (test/host covers it with programs).
    expect(view.nextStep).toBe("Call the time or weather tool with permission to download it, or run /utilities-install.")
    expect(view.platform).toEqual({ target, availability: "AVAILABLE" })
    expect(Object.keys(view.modules).sort()).toEqual([...MODULES].sort())
    expect(view.permissions.askByDefault).toEqual([...DEFAULT_ASK])
  })

  test("reports the time and weather programs not installed, with the coded availability and its next step, and downloads nothing", async () => {
    const view = ((await host.api("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })).data as { output: Record<string, any> }).output
    expect(view.platform.availability).toBe("AVAILABLE")
    // Nothing is cached and the package carries none: each program is reported with its code and a next step.
    for (const module of ["time", "weather"]) {
      expect(view.modules[module]).toMatchObject({ availability: "NATIVE_FILES_MISSING" })
      expect(String(view.modules[module].next)).toMatch(/\S/)
    }
    // manifest/speech-assets.json is read from the same root and has an engine exactly where one is built.
    const speech = JSON.parse(readFileSync(join(installed, "manifest/speech-assets.json"), "utf8")) as { engines: Record<string, unknown> }
    expect(Boolean(speech.engines[target])).toBe(speechEngine)
    if (speechEngine) {
      expect(view.modules.speech.availability).toBe("SPEECH_ASSETS_MISSING")
      expect(view.speech.assets.length).toBeGreaterThan(0)
    } else {
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
    const block = [
      { action: "utilities_*", resource: "*", effect: "ask" },
      ...READ_ACTIONS.map(action => ({ action, resource: "*", effect: "allow" })),
      ...DEFAULT_ASK.map(action => ({ action, resource: "*", effect: "ask" })),
    ]
    expect(build!.permissions.slice(base + 1, base + 1 + block.length)).toEqual(block)
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
      for (const method of value.methods.filter((m: { name: string }) => /^(?:time|timer|weather)_/.test(m.name))) expect(method).toMatchObject({ available: true })
      expect(Object.fromEntries(value.methods.map((method: { name: string; class: string }) => [method.name, method.class]))).toMatchObject({
        time_now: "read", timer_set: "write", timer_delete: "write", speech_synthesize: "export",
      })
      for (const name of ["timer_set", "timer_delete", "speech_synthesize"])
        expect(await call("build", name, { name: "review", deadline: "2026-11-02T09:00:00Z", text: "hello" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("allowed", "unknown_tool", {})).toMatchObject({ type: "rpc.method_not_found" })
    })

    test("refuses a tool the agent hides, and applies the session's rules after the agent's", async () => {
      expect(await call("locked", "time_now", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("narrow", "time_now", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await call("reopen", "time_zones", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    })

    test("refuses the speech download ask at once with no approval prompt left waiting", async () => {
      // Weather is a read, so the ask a script can hit at `ask-changes` is the download the first speech call needs.
      const asks = speechEngine ? ["speech_transcribe"] : []
      for (const method of asks) {
        const started = Date.now()
        const result = await call("build", method, { path: "clip.wav" })
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
  // No program is seeded: the host's cache starts empty, as a first install's does.
  // `locked`, an agent defined only in config, hides the time tools: the tools RPC tests use it.
  // `access: "ask-changes"` exercises the option end to end on the installed package: its block asks for the changes.
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: [{ package: installed, options: { access: "ask-changes" } }], agents: { locked: { mode: "primary", permissions: [rule("utilities_time_*", "deny")] } } }))
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
