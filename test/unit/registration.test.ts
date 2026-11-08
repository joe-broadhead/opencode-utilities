import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ACCESS_VALUES, DEFAULT_ASK, READ_ACTIONS, MODULES, TOOLS, WEATHER_ATTRIBUTION, registrable, toolRegistrable, type Availability, type Invocation, type StatusFacts, type StatusView, type ToolName } from "../../src/domain/contract.js"
import { commandTransform } from "../../src/host/commands.js"
import { createPlugin } from "../../src/host/plugin.js"
import { commandAuthorize, createAuthorize, DEFAULT_RULES, defaultRules, evaluate, insertDefaultRules, unguardedAgents } from "../../src/host/permissions.js"
import { loadSkills, skillTransform } from "../../src/host/skills.js"
import { buildStatus } from "../../src/host/status.js"
import { toolTransform } from "../../src/host/tools.js"
import { AGENT_FIX, compactStatus, completeStatus, formatStatus, formatSummary, nextStep, rulesToPaste, STATUS_JSON_SCHEMA } from "../../src/rpc.js"
import { checkHost } from "../../src/host/compat.js"
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
const FACTS: StatusFacts = {
  version: VERSION,
  host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
  unguardedAgents: [],
  access: "all",
  platform: { target: "darwin-arm64", availability: "AVAILABLE" },
  modules: modulesWith({}),
  weather: { tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION },
  speech: { assets: [], voices: [], preseeded: false, cacheDirectory: "/cache", outputDirectory: "/out" },
  timers: { directory: "/timers" },
  shadowedSkills: [],
  permissions: { askByDefault: [...DEFAULT_ASK], block: [...DEFAULT_RULES] },
}
const VIEW: StatusView = completeStatus(FACTS)
const status = (facts: Partial<StatusFacts>) => completeStatus({ ...FACTS, ...facts })
const context = (signal = new AbortController().signal) => ({ sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal })

describe("tools", () => {
  const sources = (invoke = vi.fn(async (tool: ToolName) => SAMPLES[tool as Exclude<ToolName, "status">]), settle = vi.fn(async () => {})) => ({
    runtime: { invoke }, weather: { settle }, status: async () => VIEW, modules: () => modulesWith({}),
  })

  test("only available modules register; speech stays while only its models are missing", () => {
    for (const [availability, registered] of [
      [{}, 24],
      [{ speech: "SPEECH_ASSETS_MISSING" }, 24],
      [{ speech: "UNSUPPORTED_PLATFORM" }, 22],
      [{ weather: "PLATFORM_PACKAGE_MISSING", time: "PLATFORM_PACKAGE_MISSING" }, 3],
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
    expect(toolRegistrable("speech_transcribe", modulesWith({ speech: "UNSUPPORTED_PLATFORM" }))).toBe(false)
    expect(toolRegistrable("speech_transcribe", modulesWith({ speech: "SPEECH_ASSETS_MISSING" }))).toBe(true)
    expect(toolRegistrable("speech_synthesize", modulesWith({ speech: "DISABLED" }))).toBe(false)
  })

  test("the namespace text lists the call of every registered tool, on one line, so Code Mode needs no search (it3 grading)", () => {
    const describe = (availability: Parameters<typeof modulesWith>[0]) => {
      const { namespaces, editor } = toolEditor()
      toolTransform({ ...sources(), modules: () => modulesWith(availability) })(editor)
      return namespaces[0]!.description
    }
    const all = describe({})
    expect(all).not.toContain("\n")
    expect(all).toContain("tools.utilities.<name>(input)")
    for (const call of [
      "time_now({timezones?, format?})",
      "time_convert({datetime, from_timezone, to_timezone})",
      `time_holidays({mode: "check", date, country, region?} | {mode: "list", year, country, region?})`,
      `time_business_days({mode: "between", from, to, country?, region?} | {mode: "next" | "prev", date, country?, region?})`,
      "timer_check({offset?, limit?})",
      "weather_geocode({query, country?, count?})",
      "weather_daily({location, country?, days?})",
      "speech_transcribe({path, language?})",
      "speech_synthesize({text, voice?, path?})",
      "status({})",
    ]) expect(all).toContain(call)
    for (const name of Object.keys(TOOLS)) expect(all, name).toMatch(new RegExp(`\\b${name}\\(\\{`))
    expect(all).toContain("pass region (England, Wales, Scotland or Northern Ireland)")
    expect(all).toContain("If the user declines a weather call, say no weather was fetched and stop.")
    const noSpeech = describe({ speech: "UNSUPPORTED_PLATFORM", weather: "DISABLED" })
    expect(noSpeech).not.toMatch(/speech_|weather_|weather call/)
    expect(noSpeech).toContain("time_now({timezones?, format?})")
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
  const transform = (state: Record<string, Rule[]>, access: "all" | "ask-changes" | "read-only" = "all") =>
    insertDefaultRules(access)({ list: () => Object.keys(state).map(id => ({ id })), update: (id, update) => update({ permissions: state[id]! }) })

  test("the ask rules go directly after the base allow, once per rebuild; denies and agents without a base allow are untouched", () => {
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const state = agents()
      transform(state)
      expect(state.build).toEqual([{ action: "*", resource: "*", effect: "allow" }, ...DEFAULT_RULES, { action: "read", resource: "*.env", effect: "ask" }])
      expect(state.plan.slice(-1)).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
      expect(state.title).toEqual(agents().title)
    }
    // Every tool is allowed by default, and so is the namespace, so a tool a later release adds runs at once.
    expect(DEFAULT_RULES.map(r => r.action)).toEqual(["utilities_*", ...READ_ACTIONS, ...DEFAULT_ASK])
    expect(DEFAULT_RULES.every(r => r.effect === "allow" && r.resource === "*")).toBe(true)
    // The other two values: changes ask, or changes are denied, and reads always run.
    for (const [access, effect] of [["ask-changes", "ask"], ["read-only", "deny"]] as const) {
      // An unclassified name matches only the namespace rule, so it gets the value's effect.
      expect({ access, effect: evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules(access)], "utilities_new_tool", "*") }).toEqual({ access, effect })
      const block = defaultRules(access)
      expect(block[0]).toEqual({ action: "utilities_*", resource: "*", effect })
      expect(block.filter(r => READ_ACTIONS.includes(r.action)).every(r => r.effect === "allow")).toBe(true)
      expect(block.filter(r => (DEFAULT_ASK as readonly string[]).includes(r.action)).every(r => r.effect === effect)).toBe(true)
    }
  })

  test("agents that missed the rules are named with the per-agent fix", () => {
    const state = agents()
    transform(state, "ask-changes")
    const listed = [...Object.entries(state).map(([id, permissions]) => ({ id, permissions })), { id: "reviewer", permissions: agents().build }]
    // At `all` nothing is held back, so no agent needs the block; at a restricting value the unguarded one is named.
    expect(unguardedAgents(listed)).toEqual([])
    expect(unguardedAgents(listed, "ask-changes")).toEqual(["reviewer"])
  })

  test("an agent stays guarded when another plugin inserts its block at the same index later", () => {
    const state = agents()
    transform(state, "ask-changes")
    // A plugin that loads later splices its own block directly after the base allow too.
    const other: Rule[] = [{ action: "other_plugin_write", resource: "*", effect: "ask" }, { action: "other_plugin_*", resource: "*", effect: "ask" }]
    state.build!.splice(1, 0, ...other)
    expect(state.build!.slice(1, 3)).toEqual(other)
    // A partial or reordered copy of the block is not the block.
    const block = defaultRules("ask-changes")
    const partial = [{ action: "*", resource: "*", effect: "allow" }, ...other, ...block.slice(1)] as Rule[]
    const allowed = [{ action: "*", resource: "*", effect: "allow" }, ...other, { action: "utilities_timer_set", resource: "*", effect: "allow" }] as Rule[]
    const listed = [
      { id: "build", permissions: state.build! },
      { id: "plan", permissions: state.plan! },
      { id: "partial", permissions: partial },
      { id: "allowed", permissions: allowed },
      { id: "title", permissions: state.title! },
    ]
    // The partial copy still asks for a change, so it is not listed; an agent whose own rule allows one is.
    expect(unguardedAgents(listed, "ask-changes")).toEqual(["allowed"])
  })

  test("the per-agent fix is the one fixed sentence, and never the top-level permissions", () => {
    const next = AGENT_FIX
    // The one sentence every plugin of this family uses, verbatim (review TRIAGE, cross-plugin decision 1).
    expect(next).toBe("Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools.")
    expect(next).not.toContain("top-level permissions")
    expect(JSON.parse(rulesToPaste(VIEW))).toEqual(defaultRules(VIEW.access))
    expect(rulesToPaste(VIEW).split("\n")).toHaveLength(defaultRules(VIEW.access).length + 2) // one rule per line
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
  const unguarded = status({ unguardedAgents: ["reviewer", "mdagent"] })
  const labels = (text: string) => text.split("\n").slice(1).filter(l => /^[A-Z][\w ]*: /.test(l)).map(l => l.slice(0, l.indexOf(":")))
  const S9 = ["Connection", "Account", "Access", "Platform", "Weather", "Time and timers", "Speech", "Speech files", "Timers", "Asks first", "Skills", "Tools", "Agents without default rules", "OpenCode", "Next step"]

  test("the command shows the S9 rows in order, the block one rule per line, and exactly one next step", () => {
    const text = formatStatus(unguarded)
    expect(text.split("\n")[0]).toBe("Utilities status")
    expect(labels(text)).toEqual(S9)
    expect(text).toContain(`Agents without default rules: reviewer, mdagent\n${rulesToPaste(unguarded)}`)
    expect(text).toContain("Connection: not configured (the Open-Meteo key is optional)")
    expect(text).toContain("Tools: 24 available, 0 unknown")
    expect(text).toContain(`OpenCode: 2.2.3 (tested). Utilities ${VERSION}`)
    expect(text.match(/^Next step: /gm)).toHaveLength(1)
    expect(text.split("\n").at(-1)).toBe(`Next step: ${unguarded.nextStep}`)
    expect(unguarded.nextStep).toBe(AGENT_FIX)
    expect(formatStatus(VIEW).split("\n").at(-1)).toBe("Next step: Nothing to do.")
  })

  test("the status RPC has the shared S13 fields first, with these names, and the JSON Schema requires them", () => {
    expect(Object.keys(VIEW).slice(0, 5)).toEqual(["version", "host", "state", "unguardedAgents", "nextStep"])
    expect(VIEW).toMatchObject({ version: VERSION, host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true }, state: "ready", unguardedAgents: [], nextStep: "Nothing to do." })
    expect(STATUS_JSON_SCHEMA.required.slice(0, 5)).toEqual(["version", "host", "state", "unguardedAgents", "nextStep"])
    expect(VIEW.permissions.askByDefault).toEqual([...DEFAULT_ASK])
    expect(VIEW.permissions.block).toEqual([...DEFAULT_RULES])
    expect(status({ modules: modulesWith({ weather: "DISABLED", time: "DISABLED", speech: "DISABLED" }) }).state).toBe("disabled")
    expect(status({ modules: modulesWith({ weather: "PLATFORM_PACKAGE_MISSING", time: "PLATFORM_PACKAGE_MISSING", speech: "UNSUPPORTED_PLATFORM" }) }).state).toBe("failed")
    expect(status({ modules: modulesWith({ speech: "SPEECH_ASSETS_MISSING" }) }).state).toBe("ready")
  })

  test("tested hosts are 2.2.3, 2.2.4, 2.2.5 and 2.2.6; another 2.2 release runs untested; outside the range needs allowUntestedHost (X1, INSTALL-4)", () => {
    for (const version of ["2.2.3", "2.2.4", "2.2.5", "2.2.6"]) expect(checkHost(version, false)).toEqual({ version, range: ">=2.2.3 <2.3.0", tested: true })
    // S13: an untested release in the range sets up normally; only host.tested and the OpenCode row change.
    const later = status({ host: checkHost("2.2.99", false) })
    expect(later).toMatchObject({ state: "ready", host: { version: "2.2.99", tested: false }, nextStep: "Nothing to do." })
    const allowed = status({ host: checkHost("2.3.0", true) })
    expect(allowed).toMatchObject({ state: "ready", host: { tested: false }, nextStep: expect.stringContaining("allowUntestedHost is set") })
    expect(formatStatus(later)).toContain("OpenCode: 2.2.99 (untested; supported range >=2.2.3 <2.3.0)")
    expect(() => checkHost("2.3.0", false)).toThrow("HOST_UNTESTED: Utilities supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode 2.2.3, 2.2.4, 2.2.5 or 2.2.6, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(formatStatus(status({ host: checkHost("2.3.0", true) }))).toContain("OpenCode: 2.3.0 (host untested: outside >=2.2.3 <2.3.0; allowUntestedHost is set)")
  })

  test("a fresh install reads Nothing to do.: the speech download and the free weather tier stay in their rows (INSTALL-13)", () => {
    const fresh = status({
      modules: modulesWith({ speech: "SPEECH_ASSETS_MISSING" }),
      weather: { tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION, next: "For commercial use, run /connect and choose Open-Meteo." },
      speech: { ...FACTS.speech, assets: [{ role: "engine", name: "utilities-speech-darwin-arm64", bytes: 46_000_000, state: "missing" }], next: "Run /utilities-speech-install to download 1 file (46.0 MB), or pre-seed speech.assetsDir." },
    })
    expect(fresh.nextStep).toBe("Nothing to do.")
    expect(formatStatus(fresh)).toContain("Speech files: 1 of 1 files missing (46 MB). They download after a prompt on the first transcription or synthesis, or run /utilities-speech-install")
    // Missing pre-seeded files are a misconfiguration; macOS x64 has no engine, which needs nothing.
    const seeded = status({ modules: { ...modulesWith({}), speech: { availability: "SPEECH_ASSETS_MISSING", next: "Copy the missing speech files into speech.assetsDir." } }, speech: { ...fresh.speech, preseeded: true } })
    expect(seeded.nextStep).toBe("Copy the missing speech files into speech.assetsDir.")
    expect(status({ modules: { ...modulesWith({}), speech: { availability: "UNSUPPORTED_PLATFORM", next: "Call utilities_status." } } }).nextStep).toBe("Nothing to do.")
  })

  test("the connection and host rows use the shared state labels", () => {
    expect(formatStatus(status({ weather: { ...VIEW.weather, tier: "commercial", key: "connected" } }))).toContain("Connection: connected (Open-Meteo key)")
    expect(formatStatus(status({ weather: { ...VIEW.weather, tier: "commercial", key: "rejected" } }))).toContain("Connection: sign-in required")
    expect(formatStatus(status({ modules: modulesWith({ weather: "DISABLED" }) }))).toContain("Weather: disabled")
  })

  test("the next step goes from blocking problems to optional ones", () => {
    const facts = { ...FACTS, unguardedAgents: ["reviewer"] }
    expect(nextStep({ ...facts, host: { ...facts.host, tested: false, next: "host" } })).toBe("host")
    expect(nextStep({ ...facts, weather: { ...VIEW.weather, next: "free tier" } })).toBe(AGENT_FIX)
    expect(nextStep({ ...FACTS, weather: { ...VIEW.weather, next: "free tier" } })).toBe("Nothing to do.")
    expect(nextStep({ ...facts, weather: { ...VIEW.weather, key: "rejected", next: "rejected" }, timers: { directory: "/t", due: 1, next: "timers" } })).toBe("rejected")
    expect(nextStep({ ...FACTS, timers: { directory: "/t", due: 1, next: "timers" } })).toBe("timers")
  })

  test("the status tool counts the unguarded agents and points to /utilities-status instead of the rules", () => {
    const summary = compactStatus(unguarded), text = formatSummary(summary)
    expect(summary).toMatchObject({ unguardedAgents: 2, nextStep: AGENT_FIX })
    expect(labels(text)).toEqual(S9)
    expect(text).toContain("Agents without default rules: 2\n")
    expect(text).not.toContain("reviewer")
    expect(text).not.toContain('"effect":"ask"')
    expect(text.split("\n").at(-1)).toBe(`Next step: ${summary.nextStep}`)
    expect(compactStatus(VIEW)).toEqual({ ...VIEW, unguardedAgents: 0 })
  })

  test("only agents whose own rules would run a side effect without asking are unguarded (LIVE-1)", () => {
    const base = { action: "*", resource: "*", effect: "allow" } as const
    const agents: { id: string; permissions: { action: string; resource: string; effect: "allow" | "ask" | "deny" }[] }[] = [
      { id: "guarded", permissions: [base, ...defaultRules("ask-changes")] },
      { id: "allow-all", permissions: [base] },
      // The perf-probe agents end with *:*=ask, so every Utilities side effect already asks.
      { id: "asks-all", permissions: [base, { action: "read", resource: "*", effect: "allow" }, { action: "*", resource: "*", effect: "ask" }] },
      { id: "denies-utilities", permissions: [base, { action: "utilities_*", resource: "*", effect: "deny" }] },
      { id: "asks-weather-only", permissions: [base, { action: "utilities_weather_*", resource: "*", effect: "ask" }] },
      { id: "allows-later", permissions: [base, { action: "*", resource: "*", effect: "ask" }, { action: "utilities_timer_*", resource: "timer:*", effect: "allow" }] },
      { id: "no-base", permissions: [{ action: "*", resource: "*", effect: "deny" }] },
    ]
    expect(unguardedAgents(agents, "ask-changes")).toEqual(["allow-all", "asks-weather-only", "allows-later"])
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
  test("status names a skill with one of the plugin's ids that takes the place of its own, with the fix (TRIAGE 8)", async () => {
    const runtime = await fakeRuntimes().create({ location: { project: "p", directory: "/d", projectDirectory: "/d" }, authorize: async () => {}, modules: { weather: true, time: true, speech: true }, stateRoot: "/state", cacheRoot: "/cache" })
    const own = [{ name: "utilities-time", path: "/pkg/skills/utilities-time/SKILL.md" }, { name: "utilities-weather", path: "/pkg/skills/utilities-weather/SKILL.md" }]
    const view = await buildStatus({
      version: VERSION, host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true }, runtime, weather: { status: async () => ({ tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION }) },
      agents: async () => [], ownSkills: own,
      skills: async () => [{ id: "utilities-time", path: "/elsewhere/skills/utilities-time/SKILL.md" }, { id: "utilities-weather", path: own[1]!.path }, { id: "other", path: "/x/SKILL.md" }],
    })
    expect(view.shadowedSkills).toEqual([{ name: "utilities-time", path: "/elsewhere/skills/utilities-time/SKILL.md" }])
    expect(view.nextStep).toBe("Rename or move the skill at /elsewhere/skills/utilities-time/SKILL.md, which uses the id of the plugin's utilities-time skill, so OpenCode loads it instead of the plugin's own.")
    expect(formatStatus(view)).toContain("\nSkills: utilities-time is replaced by /elsewhere/skills/utilities-time/SKILL.md\n")
    // A skill list that fails only hides shadowed skills.
    const failed = await buildStatus({ version: VERSION, host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true }, runtime, weather: { status: async () => ({ tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION }) }, agents: async () => [], ownSkills: own, skills: async () => { throw new Error("x") } })
    expect(failed).toMatchObject({ shadowedSkills: [], nextStep: "Nothing to do." })
  })
  test("the status joins runtime and host items and drops undefined fields", async () => {
    const runtime = await fakeRuntimes().create({ location: { project: "p", directory: "/d", projectDirectory: "/d" }, authorize: async () => {}, modules: { weather: true, time: true, speech: true }, stateRoot: "/state", cacheRoot: "/cache" })
    const view = await buildStatus({
      version: VERSION, host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true }, runtime, weather: { status: async () => ({ tier: "free", key: "none", attribution: WEATHER_ATTRIBUTION }) },
      agents: async () => [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }, ...defaultRules("ask-changes")] }, { id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }] }],
      ownSkills: [], skills: async () => [], access: "ask-changes",
    })
    expect(Object.keys(view)).toEqual(["version", "host", "state", "unguardedAgents", "nextStep", "platform", "modules", "weather", "speech", "timers", "skills", "permissions", "access"].map(k => k === "skills" ? "shadowedSkills" : k))
    expect(view).toMatchObject({ state: "ready", access: "ask-changes", unguardedAgents: ["reviewer"], nextStep: AGENT_FIX, permissions: { askByDefault: [...DEFAULT_ASK] } })
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
    skill: { transform: async () => registration, reload: async () => {}, list: async () => ({ data: [] }) }, session: { synthetic: async () => {} },
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
    // The tools RPC (and the old id beside it) and its evaluate hook go with the plugin; the status RPC is the
    // host's to dispose.
    expect(disposed.sort()).toEqual(["hook", "utilities.local.tools", "utilities.tools.tools"])
    expect(runtimes.created[1]).toMatchObject({ closed: true })
    expect(runtimes.created[1]!.listenerCount()).toBe(0)
  })
})
