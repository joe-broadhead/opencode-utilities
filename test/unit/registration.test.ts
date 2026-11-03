import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_ASK, MODULES, TOOLS, WEATHER_ATTRIBUTION, registrable, toolRegistrable, type Availability, type Invocation, type StatusView, type ToolName } from "../../src/domain/contract.js"
import { commandTransform } from "../../src/host/commands.js"
import { createPlugin } from "../../src/host/plugin.js"
import { commandAuthorize, createAuthorize, DEFAULT_RULES, insertDefaultRules, unguardedAgents, unguardedNext } from "../../src/host/permissions.js"
import { loadSkills, skillTransform } from "../../src/host/skills.js"
import { buildStatus } from "../../src/host/status.js"
import { toolTransform } from "../../src/host/tools.js"
import { compactStatus, formatStatus, formatSummary, nextStep, rulesToPaste } from "../../src/rpc.js"
import { createWeatherKey } from "../../src/host/weather.js"
import { VERSION } from "../fixtures.js"
import { failure, fakeRuntimes } from "../host/runtime.js"
import { INPUTS, SAMPLES } from "../host/samples.js"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const temps: string[] = []
afterEach(async () => { await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), "utilities-unit-")); temps.push(dir); return dir }

type Added = { name: string; options: { namespace: string; permission: string; pinned?: boolean }; execute(input: unknown, context: object): Promise<{ output: unknown; content: unknown }> }
function toolEditor() {
  const added: Added[] = [], namespaces: { name: string; description: string }[] = []
  return { added, namespaces, editor: { namespace: (n: { name: string; description: string }) => { namespaces.push(n) }, add: (tool: Added) => { added.push(tool) } } as never }
}
const modulesWith = (availability: Partial<Record<(typeof MODULES)[number], Availability>>) =>
  Object.fromEntries(MODULES.map(m => [m, { availability: availability[m] ?? "AVAILABLE" }])) as StatusView["modules"]
const VIEW: StatusView = {
  version: VERSION,
  host: { required: ">=2.2.3 <2.3.0", found: "2.2.3", availability: "AVAILABLE" },
  platform: { target: "darwin-arm64", availability: "AVAILABLE" },
  modules: modulesWith({}),
  weather: { tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION },
  speech: { assets: [], voices: [], cacheDirectory: "/cache", outputDirectory: "/out" },
  timers: { directory: "/timers" },
  permissions: { askByDefault: [...DEFAULT_ASK], unguardedAgents: [] },
}
const context = (signal = new AbortController().signal) => ({ sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal })

describe("tools", () => {
  const sources = (invoke = vi.fn(async (tool: ToolName) => SAMPLES[tool as Exclude<ToolName, "status">]), settle = vi.fn(async () => {})) => ({
    runtime: { invoke }, weather: { settle }, status: async () => VIEW, modules: () => modulesWith({}),
  })

  test("only available modules register; speech stays while only its models are missing", () => {
    for (const [availability, registered] of [
      [{}, 25],
      [{ speech: "SPEECH_ASSETS_MISSING" }, 25],
      [{ speech: "UNSUPPORTED_PLATFORM" }, 23],
      [{ weather: "PLATFORM_PACKAGE_MISSING", time: "PLATFORM_PACKAGE_MISSING" }, 4],
      [{ weather: "DISABLED", time: "INTEGRITY_MISMATCH", speech: "DISABLED" }, 1],
    ] as const) {
      const { added, namespaces, editor } = toolEditor()
      toolTransform({ ...sources(), modules: () => modulesWith(availability) })(editor)
      expect(added, JSON.stringify(availability)).toHaveLength(registered)
      expect(added[0]!.name).toBe("status")
      expect(namespaces).toEqual([{ name: "utilities", description: expect.stringContaining("Open-Meteo") }])
    }
    expect(registrable("speech", "SPEECH_ASSETS_MISSING")).toBe(true)
    expect(registrable("weather", "SPEECH_ASSETS_MISSING")).toBe(false)
    // Cleanup needs no engine: registered on a platform without one, not when speech is turned off.
    expect(toolRegistrable("speech_cleanup", modulesWith({ speech: "UNSUPPORTED_PLATFORM" }))).toBe(true)
    expect(toolRegistrable("speech_transcribe", modulesWith({ speech: "UNSUPPORTED_PLATFORM" }))).toBe(false)
    expect(toolRegistrable("speech_cleanup", modulesWith({ speech: "DISABLED" }))).toBe(false)
  })

  test("tools use the effective name as their permission and pin the three entry points", () => {
    const { added, editor } = toolEditor()
    toolTransform(sources())(editor)
    expect(added.map(t => t.name)).toEqual(Object.keys(TOOLS))
    for (const tool of added) expect(tool.options).toMatchObject({ namespace: "utilities", permission: `utilities_${tool.name}` })
    expect(added.filter(t => t.options.pinned).map(t => t.name)).toEqual(["time_now", "time_convert", "weather_current"])
  })

  test("a call passes the invocation to the runtime and returns its output and text", async () => {
    const s = sources(), { added, editor } = toolEditor()
    toolTransform(s)(editor)
    const ctx = context()
    await expect(added.find(t => t.name === "time_now")!.execute(INPUTS.time_now, ctx)).resolves.toEqual({ output: SAMPLES.time_now.output, content: SAMPLES.time_now.text })
    expect(s.runtime.invoke).toHaveBeenCalledWith("time_now", INPUTS.time_now, ctx)
    await expect(added.find(t => t.name === "status")!.execute({}, ctx)).resolves.toEqual({ output: compactStatus(VIEW), content: formatSummary(compactStatus(VIEW)) })
  })

  test("Utilities failures become Tool.Error with code and hint; permission errors pass through untouched", async () => {
    const declined = Object.assign(new Error(""), { _tag: "Permission.DeclinedError" })
    const invoke = vi.fn(async (tool: ToolName) => { throw tool === "time_now" ? failure("DEADLINE_EXCEEDED", "The time backend took too long.", "Try again.") : declined })
    const { added, editor } = toolEditor()
    toolTransform(sources(invoke))(editor)
    const error = await added.find(t => t.name === "time_now")!.execute({}, context()).catch(e => e)
    expect(error).toMatchObject({ _tag: "Tool.Error", message: "DEADLINE_EXCEEDED: The time backend took too long. Next step: Try again.", metadata: { code: "DEADLINE_EXCEEDED", hint: "Try again." } })
    await expect(added.find(t => t.name === "time_calendar")!.execute({}, context())).rejects.toBe(declined)
  })

  test("a rejected Open-Meteo key is reported, and a working call clears it", async () => {
    const settle = vi.fn(async () => {})
    const invoke = vi.fn(async (tool: ToolName) => { if (tool === "weather_daily") throw failure("WEATHER_KEY_REJECTED", "Open-Meteo rejected the key."); return SAMPLES.weather_current })
    const { added, editor } = toolEditor()
    toolTransform(sources(invoke, settle))(editor)
    await added.find(t => t.name === "weather_current")!.execute({}, context())
    await added.find(t => t.name === "weather_daily")!.execute({}, context()).catch(() => undefined)
    await added.find(t => t.name === "time_now")!.execute({}, context())
    expect(settle.mock.calls).toEqual([[false], [true]])
  })
})

describe("permissions", () => {
  type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
  const agents = () => ({
    build: [{ action: "*", resource: "*", effect: "allow" }, { action: "read", resource: "*.env", effect: "ask" }] as Rule[],
    plan: [{ action: "*", resource: "*", effect: "allow" }, { action: "edit", resource: "*", effect: "deny" }] as Rule[],
    title: [{ action: "*", resource: "*", effect: "deny" }] as Rule[],
  })
  const transform = (state: Record<string, Rule[]>) => insertDefaultRules({ list: () => Object.keys(state).map(id => ({ id })), update: (id, update) => update({ permissions: state[id]! }) })

  test("the ask rules go directly after the base allow, once per rebuild; denies and agents without a base allow are untouched", () => {
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const state = agents()
      transform(state)
      expect(state.build).toEqual([{ action: "*", resource: "*", effect: "allow" }, ...DEFAULT_RULES, { action: "read", resource: "*.env", effect: "ask" }])
      expect(state.plan.slice(-1)).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
      expect(state.title).toEqual(agents().title)
    }
    expect(DEFAULT_RULES.map(r => r.action)).toEqual([...DEFAULT_ASK])
    expect(DEFAULT_RULES.every(r => r.effect === "ask" && r.resource === "*")).toBe(true)
  })

  test("agents that missed the rules are named with the per-agent fix", () => {
    const state = agents()
    transform(state)
    const listed = [...Object.entries(state).map(([id, permissions]) => ({ id, permissions })), { id: "reviewer", permissions: agents().build }]
    expect(unguardedAgents(listed)).toEqual(["reviewer"])
    expect(unguardedNext([])).toBeUndefined()
  })

  test("an agent stays guarded when another plugin inserts its block at the same index later", () => {
    const state = agents()
    transform(state)
    // A plugin that loads later splices its own block directly after the base allow too.
    const other: Rule[] = [{ action: "other_plugin_write", resource: "*", effect: "ask" }, { action: "other_plugin_*", resource: "*", effect: "ask" }]
    state.build!.splice(1, 0, ...other)
    expect(state.build!.slice(1, 3)).toEqual(other)
    // A partial or reordered copy of the block is not the block.
    const partial = [{ action: "*", resource: "*", effect: "allow" }, ...other, ...DEFAULT_RULES.slice(1)] as Rule[]
    const listed = [{ id: "build", permissions: state.build! }, { id: "plan", permissions: state.plan! }, { id: "partial", permissions: partial }, { id: "title", permissions: state.title! }]
    expect(unguardedAgents(listed)).toEqual(["partial"])
  })

  test("the per-agent fix names the agents and never the top-level permissions", () => {
    const next = unguardedNext(["reviewer", "mdagent"])!
    expect(next).toContain("reviewer, mdagent")
    expect(next).toContain("Put the block shown with them first in each of those agents' own permissions (agents.<name>.permissions")
    expect(next).toContain("followed by any rules you already have for utilities_* actions in the top-level permissions")
    expect(JSON.parse(rulesToPaste(VIEW))).toEqual(DEFAULT_RULES)
    expect(rulesToPaste(VIEW).split("\n")).toHaveLength(DEFAULT_RULES.length + 2) // one rule per line
    expect(next).not.toMatch(/top-level permissions block|add .* to the top-level/i)
  })

  test("a tool call asserts each request in order with one plain argument", async () => {
    const assert = vi.fn(async (..._args: unknown[]) => {})
    await createAuthorize(assert)([
      { action: "external_directory", resources: ["/outside/*"] },
      { action: "utilities_speech_synthesize", resources: ["/outside/a.wav"], save: ["*"], metadata: { voice: "Luna" } },
    ], context() as Invocation)
    expect(assert.mock.calls.map(call => call.length)).toEqual([1, 1])
    expect(assert.mock.calls.map(call => call[0])).toEqual([
      { sessionID: "ses_1", agent: "build", source: { type: "tool", messageID: "msg_1", id: "call_1" }, action: "external_directory", resources: ["/outside/*"] },
      { sessionID: "ses_1", agent: "build", source: { type: "tool", messageID: "msg_1", id: "call_1" }, action: "utilities_speech_synthesize", resources: ["/outside/a.wav"], save: ["*"], metadata: { voice: "Luna" } },
    ])
  })

  test("cancelling while the prompt is open rejects at once, and a late approval cannot cause an effect", async () => {
    let approve!: () => void
    const assert = vi.fn(() => new Promise<void>(resolve => { approve = resolve }))
    const controller = new AbortController(), work = createAuthorize(assert)([{ action: "utilities_timer_set", resources: ["timer:a"] }, { action: "utilities_timer_set", resources: ["timer:b"] }], context(controller.signal) as Invocation)
    await vi.waitFor(() => expect(assert).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(work).rejects.toMatchObject({ code: "CANCELLED" })
    approve()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(assert).toHaveBeenCalledTimes(1)
    const aborted = new AbortController(); aborted.abort()
    await expect(createAuthorize(assert)([{ action: "utilities_timer_set", resources: ["timer:c"] }], context(aborted.signal) as Invocation)).rejects.toMatchObject({ code: "CANCELLED" })
    expect(assert).toHaveBeenCalledTimes(1)
  })

  test("a host permission error propagates unchanged", async () => {
    const blocked = Object.assign(new Error("Permission denied: utilities_timer_set"), { _tag: "Permission.BlockedError" })
    await expect(createAuthorize(async () => { throw blocked })([{ action: "utilities_timer_set", resources: ["timer:a"] }], context() as Invocation)).rejects.toBe(blocked)
  })

  test("a command asserts as the session's agent, without a tool source", async () => {
    const assert = vi.fn(async (..._args: unknown[]) => {})
    await commandAuthorize(assert, "ses_9", new AbortController().signal)([{ action: "utilities_speech_download", resources: ["github.com"], save: ["github.com"], metadata: { bytes: 1 } }])
    expect(assert.mock.calls).toEqual([[{ sessionID: "ses_9", action: "utilities_speech_download", resources: ["github.com"], save: ["github.com"], metadata: { bytes: 1 } }]])
  })
})

describe("commands", () => {
  function setup(installSpeech = vi.fn(async ({ authorize }: { authorize?: (requests: never[]) => Promise<void> }) => { await authorize?.([{ action: "utilities_speech_download", resources: ["github.com"] }] as never[]); return { output: { downloaded: [{ name: "utilities-speech", bytes: 1 }], bytes: 1, cacheDirectory: "/cache" }, text: "Downloaded 1 speech file (0.0 MB) to /cache. Speech is ready." } })) {
    const added: { name: string; execute(input: { sessionID: string; delivery: string }): Promise<void> }[] = []
    const posts: { sessionID: string; text: string; resume?: boolean; description?: string }[] = []
    const assert = vi.fn(async (..._args: unknown[]) => {})
    commandTransform({ assert, synthetic: (async (input: never) => { posts.push(input) }) as never, runtime: { installSpeech } as never, status: async () => ({ version: "9.9.9" } as StatusView), signal: new AbortController().signal })({ add: (c: never) => { added.push(c) } } as never)
    const run = (name: string) => added.find(c => c.name === name)!.execute({ sessionID: "ses_1", delivery: "steer" })
    return { added, posts, assert, run, installSpeech }
  }
  test("both commands exist; status posts a synthetic note that does not resume the session", async () => {
    const c = setup()
    expect(c.added.map(a => a.name)).toEqual(["utilities-status", "utilities-speech-install"])
    await c.run("utilities-status").catch(() => undefined)
    expect(c.posts[0]).toMatchObject({ sessionID: "ses_1", resume: false, description: "Utilities status" })
    expect(c.posts[0]!.text).toBe("STATUS_UNAVAILABLE: Utilities status could not be read. Next step: Run /utilities-status in a session to see the error, or check the OpenCode server log.")
  })
  test("the speech install asks through the session first, then reports the cache", async () => {
    const c = setup()
    await c.run("utilities-speech-install")
    expect(c.assert).toHaveBeenCalledWith({ sessionID: "ses_1", action: "utilities_speech_download", resources: ["github.com"] })
    expect(c.posts[0]!.text).toBe("Downloaded 1 speech file (0.0 MB) to /cache. Speech is ready.")
  })
  test("a declined download and a failed download are reported, not thrown", async () => {
    const declined = setup(vi.fn(async () => { throw Object.assign(new Error(""), { _tag: "Permission.DeclinedError" }) }))
    await declined.run("utilities-speech-install")
    expect(declined.posts[0]!.text).toBe("The speech download was not approved.")
    const failed = setup(vi.fn(async () => { throw failure("DOWNLOAD_FAILED", "The download stopped early.", "Check the network and run /utilities-speech-install again.") }))
    await failed.run("utilities-speech-install")
    expect(failed.posts[0]!.text).toBe("DOWNLOAD_FAILED: The download stopped early. Next step: Check the network and run /utilities-speech-install again.")
  })
})

describe("skills", () => {
  test("the shipped skills load; a missing or malformed skill is skipped with a warning", async () => {
    expect((await loadSkills(packageRoot, () => { throw new Error("no warning expected") })).map(s => s.id)).toEqual(["utilities-time", "utilities-weather", "utilities-speech"])
    const root = await temp()
    const write = async (id: string, text: string) => { await mkdir(join(root, "skills", id), { recursive: true }); await writeFile(join(root, "skills", id, "SKILL.md"), text) }
    await write("utilities-time", "---\r\nname: utilities-time\r\ndescription: Times.\r\n---\r\n\r\n# Time\r\n")
    await write("utilities-weather", "# no front matter\n")
    const warnings: string[] = []
    const skills = await loadSkills(root, message => { warnings.push(message) })
    expect(skills.map(s => [s.id, s.info.description, s.info.content])).toEqual([["utilities-time", "Times.", "# Time"]])
    expect(warnings.sort()).toEqual(["utilities-speech", "utilities-weather"].map(id => `SKILLS_INVALID: The skill ${id} is missing or malformed, so it was skipped. Next step: Reinstall the plugin.`))
  })
  test("skills follow their module's availability", async () => {
    const skills = await loadSkills(packageRoot)
    const added: string[] = []
    skillTransform(skills, module => module !== "speech")({ add: (s: { id: string }) => { added.push(s.id) } } as never)
    expect(added).toEqual(["utilities-time", "utilities-weather"])
  })
})

describe("status rendering", () => {
  const unguarded: StatusView = { ...VIEW, permissions: { askByDefault: [...DEFAULT_ASK], unguardedAgents: ["reviewer", "mdagent"], next: unguardedNext(["reviewer", "mdagent"])! } }
  const labels = (text: string) => text.split("\n").slice(1).filter(l => /^[A-Z][\w ]*: /.test(l)).map(l => l.slice(0, l.indexOf(":")))
  const S9 = ["Connection", "Account", "Access", "Platform", "Weather", "Time and timers", "Speech", "Speech files", "Timers", "Asks first", "Tools", "Agents without default rules", "OpenCode", "Next step"]

  test("the command shows the S9 rows in order, the block one rule per line, and exactly one next step", () => {
    const text = formatStatus(unguarded)
    expect(text.split("\n")[0]).toBe("Utilities status")
    expect(labels(text)).toEqual(S9)
    expect(text).toContain(`Agents without default rules: reviewer, mdagent\n${rulesToPaste(unguarded)}`)
    expect(text).toContain("Connection: not configured (the Open-Meteo key is optional)")
    expect(text).toContain("Tools: 25 available, 0 unknown")
    expect(text).toContain(`OpenCode: 2.2.3 (tested). Utilities ${VERSION}`)
    expect(text.match(/^Next step: /gm)).toHaveLength(1)
    expect(text.split("\n").at(-1)).toBe(`Next step: ${unguarded.permissions.next}`)
    expect(formatStatus(VIEW).split("\n").at(-1)).toBe("Next step: Nothing to do.")
  })

  test("the connection and host rows use the shared state labels", () => {
    expect(formatStatus({ ...VIEW, weather: { ...VIEW.weather, tier: "commercial", key: "connected" } })).toContain("Connection: connected (Open-Meteo key)")
    expect(formatStatus({ ...VIEW, weather: { ...VIEW.weather, tier: "commercial", key: "rejected" } })).toContain("Connection: sign-in required")
    expect(formatStatus({ ...VIEW, host: { ...VIEW.host, found: "2.3.0", availability: "HOST_UNTESTED" } })).toContain("OpenCode: 2.3.0 (host untested: tested on >=2.2.3 <2.3.0)")
    expect(formatStatus({ ...VIEW, modules: modulesWith({ weather: "DISABLED" }) })).toContain("Weather: disabled")
  })

  test("the next step goes from blocking problems to optional ones", () => {
    const host = { ...unguarded.host, availability: "HOST_UNTESTED" as const, next: "host" }
    expect(nextStep({ ...unguarded, host })).toBe("host")
    expect(nextStep({ ...unguarded, weather: { ...VIEW.weather, next: "free tier" } })).toBe(unguarded.permissions.next)
    expect(nextStep({ ...VIEW, weather: { ...VIEW.weather, next: "free tier" } })).toBe("free tier")
    expect(nextStep({ ...VIEW, weather: { ...VIEW.weather, key: "rejected", next: "rejected" }, timers: { directory: "/t", due: 1, next: "timers" } })).toBe("rejected")
  })

  test("the status tool counts the unguarded agents and points to /utilities-status instead of the rules", () => {
    const summary = compactStatus(unguarded), text = formatSummary(summary)
    expect(summary.permissions).toEqual({ askByDefault: [...DEFAULT_ASK], unguardedAgents: 2, next: "2 agents lack the default ask rules. Run /utilities-status for the agents and the rules to paste." })
    expect(summary.next).toBe(summary.permissions.next)
    expect(labels(text)).toEqual(S9)
    expect(text).toContain("Agents without default rules: 2\n")
    expect(text).not.toContain("reviewer")
    expect(text).not.toContain('"effect":"ask"')
    expect(text.split("\n").at(-1)).toBe(`Next step: ${summary.next}`)
    expect(compactStatus(VIEW)).toEqual({ ...VIEW, permissions: { askByDefault: [...DEFAULT_ASK], unguardedAgents: 0 } })
  })
})

describe("weather key and status", () => {
  const connection = (status?: object) => ({ type: "credential", id: "cred_1", label: "key", method: "key", ...(status ? { status } : {}) })
  function integration(active: object | undefined, credential: object | undefined = { type: "key", key: "k-123" }) {
    const reports: unknown[] = []
    return { reports, connection: { active: vi.fn(async () => active), resolve: vi.fn(async () => credential), status: vi.fn(async (input: unknown) => { reports.push(input) }) } as never }
  }
  test("free tier, connected key and rejected key", async () => {
    expect(await createWeatherKey(integration(undefined)).status()).toMatchObject({ tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION, next: expect.stringContaining("/connect") })
    expect(await createWeatherKey(integration(connection())).status()).toEqual({ tier: "commercial", key: "connected", attribution: WEATHER_ATTRIBUTION })
    expect(await createWeatherKey(integration(connection({ status: "needs_auth", message: "x" }))).status()).toMatchObject({ key: "rejected", next: expect.stringContaining("opencode auth logout open-meteo") })
  })
  test("the key reaches the runtime; a rejection is reported once and cleared after a working call", async () => {
    const fresh = integration(connection()), key = createWeatherKey(fresh)
    expect(await key.key()).toBe("k-123")
    await key.settle(false)
    await key.settle(true)
    expect(fresh.reports).toEqual([{ integrationID: "open-meteo", connection: connection(), status: { status: "needs_auth", message: expect.stringContaining("rejected") } }])
    const flagged = integration(connection({ status: "needs_auth", message: "x" })), again = createWeatherKey(flagged)
    await again.key(); await again.settle(false)
    expect(flagged.reports).toEqual([{ integrationID: "open-meteo", connection: connection({ status: "needs_auth", message: "x" }), status: undefined }])
    expect(await createWeatherKey(integration(undefined)).key()).toBeUndefined()
  })
  test("the status joins runtime and host items and drops undefined fields", async () => {
    const runtime = await fakeRuntimes().create({ location: { project: "p", directory: "/d", projectDirectory: "/d" }, authorize: async () => {}, modules: { weather: true, time: true, speech: true }, stateRoot: "/state", cacheRoot: "/cache" })
    const view = await buildStatus({
      version: VERSION, host: { required: ">=2.2.3 <2.3.0", found: "2.2.3", availability: "AVAILABLE" }, runtime, weather: { status: async () => ({ tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION }) },
      agents: async () => [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }, ...DEFAULT_RULES] }, { id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }] }],
    })
    expect(Object.keys(view)).toEqual(["version", "host", "platform", "modules", "weather", "speech", "timers", "permissions"])
    expect(view.permissions).toMatchObject({ askByDefault: [...DEFAULT_ASK], unguardedAgents: ["reviewer"], next: expect.stringContaining("reviewer") })
    expect(JSON.stringify(view)).toBe(JSON.stringify(JSON.parse(JSON.stringify(view))))
    expect("next" in view.host).toBe(false)
  })
})

describe("setup", () => {
  const registration = { dispose: async () => {} }
  const disposed: string[] = []
  const ctx = (fail: boolean) => ({
    options: {}, app: { version: "2.2.3" }, location: { directory: "/repo/app", project: { id: "p", directory: "/repo" } },
    permission: { assert: async () => {}, hook: async () => ({ dispose: async () => void disposed.push("hook") }) },
    integration: { transform: async () => registration, connection: {} },
    agent: { transform: async () => registration, list: async () => ({ data: [] }) },
    tool: { transform: async () => { if (fail) throw new Error("registration failed"); return registration }, reload: async () => {} },
    rpc: { register: async (contract: { id: string }) => ({ dispose: async () => void disposed.push(contract.id) }) }, command: { transform: async () => registration },
    skill: { transform: async () => registration, reload: async () => {} }, session: { synthetic: async () => {} },
  }) as never
  test("the runtime's location carries the project ID, the location directory and the project directory", async () => {
    const runtimes = fakeRuntimes()
    const cleanup = await createPlugin({ createRuntime: runtimes.create, packageRoot }).setup(ctx(false))
    expect(runtimes.created[0]!.options.location).toEqual({ project: "p", directory: "/repo/app", projectDirectory: "/repo" })
    await (cleanup as () => Promise<void>)()
  })
  test("a failing registration closes the runtime; unload closes it and its subscription", async () => {
    const runtimes = fakeRuntimes()
    const plugin = createPlugin({ createRuntime: runtimes.create, packageRoot })
    await expect(plugin.setup(ctx(true))).rejects.toThrow("registration failed")
    expect(runtimes.created[0]).toMatchObject({ closed: true })
    expect(runtimes.created[0]!.listenerCount()).toBe(0)
    const cleanup = await plugin.setup(ctx(false))
    expect(runtimes.created[1]!.listenerCount()).toBe(1)
    disposed.length = 0
    await (cleanup as () => Promise<void>)()
    // The tools RPC and its evaluate hook go with the plugin; the status RPC is the host's to dispose.
    expect(disposed.sort()).toEqual(["hook", "utilities.tools.tools"])
    expect(runtimes.created[1]).toMatchObject({ closed: true })
    expect(runtimes.created[1]!.listenerCount()).toBe(0)
  })
})
