// Utilities on the public @opencode/sdk host (no private host imports), with a fake runtime that makes
// the real runtime's permission requests. This is where V3 is recorded: the shipped permission mechanism
// is the default-ask agent rules, and user rules and saved approvals win over them.
import { HOST_VERSION, project, removeRoot, startHost } from "./harness.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Model, Plugin, Provider } from "@opencode/plugin"
import { z } from "zod"
import { DEFAULT_ASK, TOOLS, type ToolName } from "../../src/domain/contract.js"
import { createPlugin } from "../../src/host/plugin.js"
import { defaultRules } from "../../src/host/permissions.js"
import { SCRIPT_TOOLS } from "../../src/host/scripting.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { formatStatus, Utilities } from "../../src/rpc.js"
import { Rpc } from "@opencode/plugin/rpc"
import { fakeRuntimes, failure, type FakeRuntime } from "./runtime.js"
import { INPUTS, SAMPLES } from "./samples.js"

setDefaultTimeout(60_000)
const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version
const NAMES = Object.keys(TOOLS) as ToolName[]
const allow = (action: string) => ({ action, resource: "*", effect: "allow" })

type Rule = { action: string; resource: string; effect: string }
const contexts = new Map<string, Pick<Plugin.Context, "tool">>()
const observer: Plugin.Plugin = { id: "test.observer", setup(ctx) { contexts.set(ctx.location.directory, ctx) } }
const runtimes = fakeRuntimes({ speech: "SPEECH_ASSETS_MISSING" })
const dirs = {
  main: project("main", { experimental: { schedules: true }, agents: { reviewer: { mode: "primary", description: "Defined only in config" } } }),
  allowed: project("allowed", { experimental: { schedules: true }, permissions: ["utilities_weather_*", "utilities_timer_*", "utilities_speech_*"].map(allow) }),
  denied: project("denied", { experimental: { schedules: true }, permissions: [{ action: "utilities_speech_*", resource: "*", effect: "deny" }] }),
  install: project("install", {}),
  shadow: project("shadow", {}),
}
// A user's own skill with one of the plugin's ids, in the project's .opencode/skills, which OpenCode loads in place of the plugin's.
const shadowSkill = join(dirs.shadow, ".opencode", "skills", "utilities-time", "SKILL.md")
mkdirSync(dirname(shadowSkill), { recursive: true })
writeFileSync(shadowSkill, "---\nname: utilities-time\ndescription: A user's own time notes that share the plugin's skill id.\n---\n\nNotes.\n")
let host: Awaited<ReturnType<typeof startHost>>
let calls = 0, closed = false

const runtime = (directory: string) => runtimes.created.find(r => r.options.location.directory === directory) as FakeRuntime
async function boot(directory: string, agent = "build") {
  const session = await host.sdk.session.create({ agent, location: { directory } })
  // Plugins set up on the location's first listing, which fails while they are still activating.
  await waitFor(() => host.sdk.agent.list({ location: { directory } }).then(() => contexts.has(directory), () => false), 30_000)
  return session.id
}
async function tools(directory: string) {
  return (await contexts.get(directory)!.tool.list()).filter(t => t.id.startsWith("utilities_"))
}
/** Runs a registered executor with a real session, answering each permission request in turn. */
async function call(directory: string, sessionID: string, tool: ToolName, replies: ("once" | "always" | "reject")[] = [], agent = "build", input: object = INPUTS[tool]) {
  const definition = (await tools(directory)).find(t => t.id === `utilities_${tool}`)
  if (!definition) throw new Error(`utilities_${tool} is not registered`)
  const id = ++calls
  let settled: { result?: { output?: unknown; content?: unknown }; error?: any } | undefined
  const run = definition.execute(input, { sessionID, agent, messageID: `msg_test${id}`, id: `call_test${id}`, signal: new AbortController().signal, progress: async () => {} } as never)
    .then(result => (settled = { result }), error => (settled = { error }))
  const requests: { action: string; resources: readonly string[]; save?: readonly string[]; source?: unknown }[] = []
  const deadline = Date.now() + 10_000
  while (!settled && Date.now() < deadline) {
    const [request] = await host.sdk.permission.list({ sessionID })
    if (!request) { await Bun.sleep(25); continue }
    requests.push(request)
    await host.sdk.permission.reply({ sessionID, requestID: request.id, decision: replies.shift() ?? "reject" })
  }
  await run
  return { ...settled!, requests }
}
/** Runs a Code Mode program through the host's own tool path, unattended, as a schedule condition does. */
async function codemode(sessionID: string, body: string) {
  const code = `const seen = {}\n${body}\nthrow new Error("SEEN " + JSON.stringify(seen))`
  const message = await host.sdk.experimental.schedule.create({ sessionID, name: "utilities-check", when: { in: "6 hours" }, if: { code }, prompt: "never wakes" } as never)
    .then(() => "created", (error: Error) => error.message)
  const seen = /SEEN (\{.*\})/s.exec(message)
  if (!seen) throw new Error(`the program did not finish: ${message}`)
  return JSON.parse(seen[1]!) as Record<string, unknown>
}
/** Runs a Code Mode program through the host's own tool path unattended, and returns the message the run ended with. */
async function codemodeMessage(sessionID: string, body: string): Promise<string> {
  const code = `const seen = {}\n${body}\nthrow new Error("SEEN " + JSON.stringify(seen))`
  return host.sdk.experimental.schedule.create({ sessionID, name: "utilities-g4", when: { in: "6 hours" }, if: { code }, prompt: "never wakes" } as never)
    .then(() => "", (error: Error) => error.message)
}

/** Calls each tool once; `seen[name]` is the output's key count, or the error the program caught. */
const program = (names: readonly ToolName[]) => names.map(name => `try { seen[${JSON.stringify(name)}] = Object.keys(await tools.utilities.${name}(${JSON.stringify(INPUTS[name])})).length } catch (error) { seen[${JSON.stringify(name)}] = String(error.message) }`).join("\n")
const succeeded = (seen: Record<string, unknown>) => Object.fromEntries(Object.entries(seen).map(([name, value]) => [name, typeof value === "number" && value > 0 ? "ok" : value]))

beforeAll(async () => {
  const plugin = createPlugin({ createRuntime: runtimes.create, packageRoot })
  host = await startHost([
    { id: plugin.id, setup: (ctx: Plugin.Context) => plugin.setup({ ...ctx, options: { access: "ask-changes" } }) },
    observer,
  ])
})
afterAll(async () => {
  if (!closed) await host?.sdk.close()
  removeRoot()
})

describe(`Utilities on @opencode/sdk, host version ${HOST_VERSION}`, () => {
  test("registers every available tool with its description, field descriptions, pins and permission name", async () => {
    await boot(dirs.main)
    const registered = await tools(dirs.main)
    expect(registered.map(t => t.id).sort()).toEqual(NAMES.map(n => `utilities_${n}`).sort())
    expect(registered.filter(t => t.id.startsWith("utilities_timer_")).map(t => t.id).sort()).toEqual(["utilities_timer_check", "utilities_timer_delete", "utilities_timer_get", "utilities_timer_list", "utilities_timer_set"])
    for (const tool of registered) {
      expect(tool.description.length).toBeGreaterThan(60)
      expect(tool.options).toMatchObject({ namespace: "utilities", permission: tool.id })
      expect(tool.options?.codemode).not.toBe(false)
      const schema = z.toJSONSchema(tool.input as z.ZodType, { io: "input" }) as { properties?: Record<string, { description?: string }>; oneOf?: { properties: Record<string, { description?: string }> }[]; anyOf?: { properties: Record<string, { description?: string }> }[] }
      for (const shape of [schema, ...(schema.oneOf ?? schema.anyOf ?? [])]) for (const [field, property] of Object.entries(shape.properties ?? {})) expect(`${tool.id}.${field}: ${property.description ?? ""}`).toMatch(/: \S/)
    }
    expect(registered.filter(t => t.options?.pinned)).toEqual([])
    const skills = await host.sdk.skill.list({ location: { directory: dirs.main } })
    expect(skills.data.map((s: { id: string }) => s.id).filter((id: string) => id.startsWith("utilities")).sort()).toEqual(["utilities-speech", "utilities-time", "utilities-weather"])
    const commands = await host.sdk.command.list({ location: { directory: dirs.main } })
    expect(commands.data.map((c: { name: string }) => c.name).filter((n: string) => n.startsWith("utilities")).sort()).toEqual(["utilities-speech-install", "utilities-status"])
  })

  test("inserts the ask rules right after each agent's base allow; config-only agents are named with the fix", async () => {
    const { data: agents } = await host.sdk.agent.list({ location: { directory: dirs.main } })
    const rules = (id: string) => (agents as { id: string; permissions: Rule[] }[]).find(a => a.id === id)!.permissions.map(r => `${r.effect} ${r.action} ${r.resource}`)
    const block = defaultRules("ask-changes").map(r => `${r.effect} ${r.action} ${r.resource}`)
    for (const id of ["build", "plan", "general", "explore"]) expect(rules(id).slice(0, block.length + 1)).toEqual(["allow * *", ...block])
    expect(rules("plan").filter(r => r.startsWith("deny")).length).toBeGreaterThan(0)
    expect(rules("plan").findIndex(r => r.startsWith("deny"))).toBeGreaterThan(5) // Plan's own denies still come later and win
    expect(rules("explore").at(-1)?.startsWith("deny") || rules("explore").includes("deny * *")).toBe(true)
    expect(rules("reviewer").some(r => r.includes("utilities_"))).toBe(false)
    const status = await host.sdk.rpc(Utilities).status({}, { location: { directory: dirs.main } })
    expect(status.permissions.askByDefault).toEqual([...DEFAULT_ASK])
    expect(status.unguardedAgents).toContain("reviewer")
    expect(status.unguardedAgents).not.toContain("build")
    expect(status.nextStep).toBe("Put the default rules shown by /utilities-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools.")
    expect(formatStatus(status)).toContain(status.permissions.block.map((rule: { action: string; resource: string; effect: string }) => JSON.stringify(rule)).join(",\n  "))
  })

  test("status names a user's skill that takes the place of the plugin's own, read through the public skill list", async () => {
    expect((await host.sdk.rpc(Utilities).status({}, { location: { directory: dirs.main } })).shadowedSkills).toEqual([])
    const status = await host.sdk.rpc(Utilities).status({}, { location: { directory: dirs.shadow } })
    const all = (await host.sdk.skill.list({ location: { directory: dirs.shadow } })).data
    const listed = all.find((s: { id: string }) => s.id === "utilities-time") as { path: string } | undefined
    expect(listed?.path).toBe(shadowSkill)
    expect(status.shadowedSkills).toEqual([{ name: "utilities-time", path: shadowSkill }])
    expect(formatStatus(status)).toContain(`\nSkills: utilities-time is replaced by ${shadowSkill}\n`)
  })

  test("computation, timer reads and status run unattended through the host's tool path", async () => {
    const sessionID = await boot(dirs.main)
    const reads = NAMES.filter(n => TOOLS[n].effect === "compute" || TOOLS[n].effect === "read-state")
    expect(reads.length).toBe(14)
    expect(succeeded(await codemode(sessionID, program(reads)))).toEqual(Object.fromEntries(reads.map(name => [name, "ok"])))
  })

  test("a change asks under Build, and a decline propagates as the host's own error", async () => {
    const sessionID = await boot(dirs.main)
    // Weather is a read, so it runs without asking at every access value; a timer write is the change that asks.
    const weather = await call(dirs.main, sessionID, "weather_current", [])
    expect(weather.requests).toEqual([])
    expect(weather.result?.output).toMatchObject({ attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" })
    const declined = await call(dirs.main, sessionID, "timer_set", ["reject"])
    expect(declined.requests.map(r => [r.action, r.resources])).toEqual([["utilities_timer_set", ["timer:review"]]])
    expect(declined.requests[0]!.source).toMatchObject({ type: "tool" })
    expect(declined.error).toBeDefined()
    expect(declined.error.metadata?.code).toBeUndefined()
    for (const tool of ["timer_set", "timer_delete"] as const) {
      const asked = await call(dirs.main, sessionID, tool, ["once"])
      expect(asked.requests.map(r => [r.action, r.resources, r.save])).toEqual([[`utilities_${tool}`, ["timer:review"], ["timer:*"]]])
    }
  })

  test("Code Mode asks for a timer write and a synthesised file, and with nobody present nothing runs", async () => {
    const sessionID = await boot(dirs.main)
    const before = runtime(dirs.main).calls.length
    for (const tool of ["timer_set", "speech_synthesize"] as const) {
      const message = await codemodeMessage(sessionID, program([tool]))
      expect(message).toContain(`utilities_${tool}`)
      expect(message).toMatch(/needs approval|Permission|nobody is present/i)
    }
    // The asks stopped the calls inside Code Mode: the runtime ran neither tool, so no timer and no WAV were written.
    expect(runtime(dirs.main).calls.slice(before)).toEqual([])
  })

  test("Code Mode has no tool the plugin did not register, so an unknown name cannot run", async () => {
    const sessionID = await boot(dirs.main)
    // The host refuses the program before it runs: the name is not a tool this plugin registered.
    const before = runtime(dirs.main).calls.length
    const message = await codemodeMessage(sessionID, 'await tools.utilities.unknown_tool({})')
    expect(message).toContain("Unknown Code Mode tool: utilities.unknown_tool")
    expect(runtime(dirs.main).calls.slice(before)).toEqual([])
    expect(runtime(dirs.main).calls.filter(c => !NAMES.includes(c.tool))).toEqual([])
  })

  test("the speech download asks before its first use, then the tool list reloads", async () => {
    const sessionID = await boot(dirs.main)
    const speech = await call(dirs.main, sessionID, "speech_synthesize", ["once", "once"])
    expect(speech.requests.map(r => r.action)).toEqual(["utilities_speech_download", "utilities_speech_synthesize"])
    expect(speech.result?.output).toMatchObject({ path: expect.any(String), sha256: expect.any(String) })
    const status = await host.sdk.rpc(Utilities).status({}, { location: { directory: dirs.main } })
    expect(status.modules.speech.availability).toBe("AVAILABLE")
    // A module that becomes unavailable disappears; it comes back when it recovers.
    runtime(dirs.main).setAvailability("weather", "INTEGRITY_MISMATCH")
    await waitFor(async () => !(await tools(dirs.main)).some(t => t.id === "utilities_weather_current"))
    expect((await tools(dirs.main)).some(t => t.id === "utilities_time_now")).toBe(true)
    runtime(dirs.main).setAvailability("weather", "AVAILABLE")
    await waitFor(async () => (await tools(dirs.main)).some(t => t.id === "utilities_weather_current"))
  })

  test("a saved Always allow skips the next prompt (V3)", async () => {
    const sessionID = await boot(dirs.main)
    const first = await call(dirs.main, sessionID, "timer_set", ["always"], "build", { name: "first", deadline: "2026-11-02T09:00:00Z" })
    expect(first.requests).toHaveLength(1)
    const { projectID } = await host.sdk.session.get({ sessionID })
    const saved = (await host.sdk.permission.saved.list({ projectID }) as { id: string; action: string; resource: string }[]).filter(s => s.action === "utilities_timer_set")
    expect(saved.map(s => s.resource)).toEqual(["timer:*"])
    const second = await call(dirs.main, sessionID, "timer_set", [], "build", { name: "second", deadline: "2026-11-02T09:00:00Z" })
    expect(second.requests).toHaveLength(0)
    expect(second.error).toBeUndefined()
    for (const item of saved) await host.sdk.permission.saved.remove({ id: item.id })
  })

  test("config allow rules skip the prompts, and every tool executes through the host's tool path (V3)", async () => {
    const sessionID = await boot(dirs.allowed)
    for (const tool of ["weather_current", "timer_set", "speech_synthesize"] as const) {
      const result = await call(dirs.allowed, sessionID, tool)
      expect([tool, result.requests.length, result.error]).toEqual([tool, 0, undefined])
    }
    const half = Math.ceil(NAMES.length / 2)
    const seen = { ...await codemode(sessionID, program(NAMES.slice(0, half))), ...await codemode(sessionID, program(NAMES.slice(half))) }
    expect(succeeded(seen)).toEqual(Object.fromEntries(NAMES.map(name => [name, "ok"])))
  })

  test("a user deny hides and blocks the tools it names", async () => {
    const sessionID = await boot(dirs.denied)
    await expect(codemode(sessionID, program(["speech_transcribe"]))).rejects.toThrow("Permission denied: utilities_speech_transcribe")
    expect(succeeded(await codemode(sessionID, program(["time_now"])))).toEqual({ time_now: "ok" })
  })

  test("Utilities failures reach the caller as Tool.Error with code and next step", async () => {
    const sessionID = await boot(dirs.main)
    runtime(dirs.main).failures.set("time_calendar", failure("TIMER_EXISTS", "A timer named 'review' already exists.", "Call utilities_timer_set with replace: true to overwrite it."))
    const failed = await call(dirs.main, sessionID, "time_calendar")
    runtime(dirs.main).failures.clear()
    expect(failed.error?._tag).toBe("Tool.Error")
    expect(failed.error?.message).toBe("TIMER_EXISTS: A timer named 'review' already exists. Next step: Call utilities_timer_set with replace: true to overwrite it.")
    expect(failed.error?.metadata).toEqual({ code: "TIMER_EXISTS", hint: "Call utilities_timer_set with replace: true to overwrite it." })
  })

  test("commands: status posts to the session; the speech install asks as the session's agent first", async () => {
    const sessionID = await boot(dirs.install)
    await host.sdk.session.command({ sessionID, name: "utilities-status", text: "" })
    const install = host.sdk.session.command({ sessionID, name: "utilities-speech-install", text: "" })
    let request: Awaited<ReturnType<typeof host.sdk.permission.list>>[number] | undefined
    await waitFor(async () => (request = (await host.sdk.permission.list({ sessionID }))[0]) !== undefined)
    expect(request).toMatchObject({ action: "utilities_speech_download", resources: ["github.com"] })
    expect(request!.source).toBeUndefined()
    await host.sdk.permission.reply({ sessionID, requestID: request!.id, decision: "once" })
    await install
    const inbox = (await host.sdk.session.inbox.list({ sessionID })) as unknown as { payload?: { text?: string } }[]
    const texts = inbox.map(item => item.payload?.text ?? "")
    expect(texts[0]).toStartWith("Utilities status\nConnection: ")
    expect(texts[0]).toContain(`Utilities ${version}`)
    expect(texts[0]).toContain(`\nOpenCode: ${HOST_VERSION} (tested). `)
    expect(texts[1]).toStartWith("Downloaded 1 speech file")
    expect(runtime(dirs.install).modules.speech).toBe("AVAILABLE")
  })
})

describe(`the tools RPC ${TOOLS_RPC_ID} on @opencode/sdk, host version ${HOST_VERSION}`, () => {
  // Every name a script might try: the methods, the excluded tools and one that does not exist.
  const NAMED = [...NAMES, "unknown_tool"]
  const any = { type: "object" } as const
  const client = () => host.sdk.rpc(Rpc.define({ id: TOOLS_RPC_ID, methods: Object.fromEntries(["describe", ...NAMED].map(name => [name, { input: any, output: any, errors: { failed: any } }])), events: {} } as never)) as unknown as Record<string, (input: unknown, options: object) => Promise<any>>
  /** A method's output, or its error's `{ type, code, message }`. */
  async function script(directory: string, method: string, input: unknown): Promise<Record<string, any>> {
    try { return { value: await client()[method]!(input, { location: { directory } }) } }
    catch (error) { const e = error as Record<string, any>; return { type: e.type ?? e._tag, code: e.data?.code, message: String(e.message ?? e) } }
  }
  const rule = (action: string, effect: string, resource = "*") => ({ action, resource, effect })
  const sessions: Record<string, string> = {}
  let directory: string
  const call = (session: string, method: string, input: object = INPUTS[method as ToolName]) => script(directory, method, { sessionID: sessions[session] ?? session, input })

  beforeAll(async () => {
    directory = project("scripts", { agents: { locked: { mode: "primary", permissions: [rule("utilities_time_*", "deny")] } } })
    sessions.build = await boot(directory)
    const create = async (input: object) => (await host.sdk.session.create({ location: { directory }, ...input } as never)).id
    sessions.locked = await create({ agent: "locked" })
    sessions.agentless = await create({})
    // Session rules come after the agent's: one narrows build, one reopens a tool for locked, one allows the asks.
    sessions.narrow = await create({ agent: "build", permissions: [rule("utilities_time_now", "deny")] })
    sessions.reopen = await create({ agent: "locked", permissions: [rule("utilities_time_now", "allow")] })
    sessions.allowed = await create({ agent: "build", permissions: [rule("utilities_*", "allow")] })
    sessions.resource = await create({ agent: "build", permissions: [rule("utilities_weather_*", "allow"), rule("utilities_weather_daily", "deny", "api.open-meteo.com")] })
  })

  test("describes every tool with its class; a write is refused before it runs unless the session allows it", async () => {
    const { value } = await script(directory, "describe", {})
    expect(value.id).toBe(TOOLS_RPC_ID)
    expect(value.methods.map((method: { name: string }) => method.name)).toEqual([...SCRIPT_TOOLS])
    expect(SCRIPT_TOOLS).toHaveLength(24)
    for (const method of value.methods) expect(method).toMatchObject({ kind: "plugin", action: `utilities_${method.name}`, available: true, input: expect.any(Object), output: expect.any(Object) })
    expect(Object.fromEntries(value.methods.map((method: { name: string; class: string }) => [method.name, method.class]))).toMatchObject({
      time_now: "read",
      timer_set: "write",
      timer_delete: "write",
      weather_current: "read",
      speech_transcribe: "read",
      speech_synthesize: "export",
    })
    for (const name of ["timer_set", "timer_delete", "speech_synthesize"] as const) {
      expect(await call("build", name, INPUTS[name])).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    }
    expect(runtime(directory).calls.filter(c => !SCRIPT_TOOLS.includes(c.tool))).toEqual([])
    expect(await call("build", "unknown_tool", {})).toMatchObject({ type: "rpc.method_not_found" })
  })

  test("describe follows module availability: a method is available exactly when the model's tool is registered", async () => {
    runtime(directory).setAvailability("weather", "INTEGRITY_MISMATCH")
    try {
      await waitFor(async () => !(await tools(directory)).some(t => t.id === "utilities_weather_current"))
      const { value } = await script(directory, "describe", {})
      const byName = Object.fromEntries(value.methods.map((method: { name: string }) => [method.name, method]))
      for (const name of SCRIPT_TOOLS.filter(n => n.startsWith("weather_"))) expect(byName[name]).toMatchObject({ available: false, reason: "INTEGRITY_MISMATCH" })
      expect(byName.time_now).toMatchObject({ available: true })
      expect(byName.time_now.reason).toBeUndefined()
      // Speech stays available while only its files are missing: the first call asks to download them.
      expect(byName.speech_transcribe).toMatchObject({ available: true })
    } finally {
      runtime(directory).setAvailability("weather", "AVAILABLE")
    }
  })

  test("the ids before the rename answer the same calls, say they are deprecated, and status notes the call", async () => {
    // The tools RPC under `utilities.tools.tools`: the same methods, and `describe` says to move.
    const legacy = host.sdk.rpc(Rpc.define({ id: "utilities.tools.tools", methods: { describe: { input: any, output: any, errors: { failed: any } } }, events: {} } as never)) as unknown as { describe: (i: unknown, o: object) => Promise<Record<string, any>> }
    const described = await legacy.describe({}, { location: { directory } })
    expect(described.methods.map((method: { name: string }) => method.name)).toEqual((await client().describe({}, { location: { directory } })).methods.map((method: { name: string }) => method.name))
    expect(described.deprecated).toBe("use utilities.local.tools")
    // The status RPC under `utilities.tools`, and the one line it leaves behind on the new id.
    const old = host.sdk.rpc(Rpc.define({ id: "utilities.tools", methods: { status: { input: any, output: any, errors: { failed: any } } }, events: {} } as never)) as unknown as { status: (i: unknown, o: object) => Promise<Record<string, any>> }
    expect((await old.status({}, { location: { directory } })).version).toBe(version)
    const status = await host.sdk.rpc(Utilities).status({}, { location: { directory } })
    expect(status.deprecated).toBe("Deprecated id called: utilities.tools, utilities.tools.tools. Use utilities.local, utilities.local.tools instead; the old id works until the next minor release.")
    expect(formatStatus(status)).toContain("Deprecated: Deprecated id called:")
  })

  test("runs a read as the session and its agent with no model turn, and returns the tool's output", async () => {
    const before = runtime(directory).calls.length
    expect(await call("build", "time_now")).toEqual({ value: SAMPLES.time_now.output })
    // Parsed with the tool's own schema, defaults included, as the host parses the model's call.
    expect(runtime(directory).calls.slice(before)).toEqual([{ tool: "time_now", input: { ...INPUTS.time_now, format: "rfc3339" } }])
    // This suite's host runs at ask-changes, so status reports that value, its four asks and its block.
    expect((await call("build", "status", {})).value).toMatchObject({ version, access: "ask-changes", permissions: { askByDefault: [...DEFAULT_ASK] } })
    expect((await call("build", "status", {})).value.permissions.block).toEqual([...defaultRules("ask-changes")])
    const session = await host.sdk.session.get({ sessionID: sessions.build! })
    expect(session.tokens).toMatchObject({ input: 0, output: 0 })
  })

  test("checks the tool's input itself, before the runtime runs", async () => {
    const before = runtime(directory).calls.length
    expect(await call("build", "time_now", { timezones: "UTC", extra: 1 })).toMatchObject({ type: "failed", code: "INPUT_INVALID" })
    expect(await call("build", "status", { extra: 1 })).toMatchObject({ type: "failed", code: "INPUT_INVALID" })
    expect(runtime(directory).calls.length).toBe(before)
  })

  test("refuses a tool the agent's rules hide, and applies the session's rules after the agent's", async () => {
    const before = runtime(directory).calls.length
    expect(await call("locked", "time_now")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(await call("narrow", "time_now")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(runtime(directory).calls.length).toBe(before)
    expect(await call("narrow", "time_zones")).toEqual({ value: SAMPLES.time_zones.output })
    expect(await call("reopen", "time_now")).toEqual({ value: SAMPLES.time_now.output })
    expect(await call("reopen", "time_zones")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
  })

  test("refuses the speech download ask at once, with no prompt left waiting; an allow rule lets it run", async () => {
    // Weather is a read now, so the refusal a script can hit is the download a first transcription or synthesis needs.
    for (const method of ["speech_transcribe"]) {
      const started = Date.now()
      const refused = await call("build", method)
      expect(refused).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(refused.message).toMatch(/cannot answer/)
      expect(Date.now() - started).toBeLessThan(5000)
    }
    expect(await host.sdk.permission.list({ sessionID: sessions.build! })).toEqual([])
    expect(runtime(directory).modules.speech).toBe("SPEECH_ASSETS_MISSING")
    expect(await call("allowed", "weather_current")).toEqual({ value: SAMPLES.weather_current.output })
    expect(await call("allowed", "speech_transcribe")).toEqual({ value: SAMPLES.speech_transcribe.output })
  })

  test("a host deny on the call's resource is PERMISSION_DENIED; a Utilities failure keeps its code and next step", async () => {
    expect(await call("resource", "weather_daily")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED", message: expect.stringContaining("utilities_weather_daily") })
    expect(await call("resource", "weather_summary")).toEqual({ value: SAMPLES.weather_summary.output })
    runtime(directory).failures.set("time_calendar", failure("TIMER_EXISTS", "A timer named 'review' already exists.", "Call utilities_timer_set with replace: true to overwrite it."))
    try {
      const failed = await call("build", "time_calendar")
      expect(failed).toEqual({ type: "failed", code: "TIMER_EXISTS", message: "TIMER_EXISTS: A timer named 'review' already exists. Next step: Call utilities_timer_set with replace: true to overwrite it." })
    } finally { runtime(directory).failures.clear() }
  })

  test("names an unknown session and a session without an agent, and refuses a bad envelope", async () => {
    expect(await call("ses_does_not_exist", "time_now")).toMatchObject({ type: "failed", code: "SESSION_UNKNOWN" })
    expect(await call("agentless", "time_now")).toMatchObject({ type: "failed", code: "SESSION_AGENT_REQUIRED" })
    for (const envelope of [{ sessionID: sessions.build, input: {}, extra: true }, { input: {} }, { sessionID: sessions.build }])
      expect(await script(directory, "time_now", envelope)).toMatchObject({ type: "rpc.invalid_input" })
  })
})

describe("the Code Mode catalogue", () => {
  test("the utilities section is at most 1,000 tokens", async () => {
    const directory = project("catalogue", {})
    const previous = process.cwd()
    process.chdir(directory)
    const mock = startCatalogueMock()
    const filler = Plugin.define({
      id: "utilities.catalogue.filler",
      async setup(ctx) {
        const providerID = Provider.ID.make("mock")
        await ctx.provider.transform(editor => {
          editor.add({
            info: { ...Provider.Info.empty(providerID), name: "Mock", activation: "enabled", package: ["@opencode", "ai", "providers", "openai-compatible"].join("/"), settings: { baseURL: mock.baseURL, apiKey: "mock" } } as never,
            models: [{ ...Model.Info.default(providerID, Model.ID.make("m1")), name: "Mock 1" }],
          })
        })
        await ctx.model.transform(editor => editor.default.set("mock", "m1"))
        await ctx.tool.transform(editor => {
          editor.namespace({ name: "filler", description: "Spends the catalogue budget." })
          editor.add({
            name: "pad",
            description: "pad",
            input: z.object({ note: z.string().describe("x".repeat(9000)) }),
            options: { namespace: "filler", permission: "filler_pad", pinned: true },
            execute: async () => ({ content: "ok" }),
          } as never)
        })
      },
    })
    let catalogueHost: Awaited<ReturnType<typeof startHost>> | undefined
    try {
      catalogueHost = await startHost([createPlugin({ createRuntime: runtimes.create, packageRoot }), filler])
      const session = await catalogueHost.sdk.session.create({ agent: "build", location: { directory } })
      await catalogueHost.sdk.session.prompt({ sessionID: session.id, text: "Reply with ok." })
      const deadline = Date.now() + 30_000
      while (!mock.text().includes("- utilities (") && Date.now() < deadline) await Bun.sleep(50)
      const lines = mock.text().split("\n")
      const start = lines.findIndex(line => line.startsWith("- utilities ("))
      const taken = start < 0 ? [] : [lines[start]!]
      for (let i = start + 1; i < lines.length && lines[i]!.startsWith("  "); i++) taken.push(lines[i]!)
      const text = taken.join("\n")
      expect(text.startsWith("- utilities (")).toBe(true)
      expect(Math.round(text.length / 4)).toBeLessThanOrEqual(1000)
      expect(text).toContain("utilities-time")
    } finally {
      process.chdir(previous)
      mock.stop()
      await catalogueHost?.sdk.close()
    }
  })
})

function startCatalogueMock() {
  let captured = ""
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "m1", object: "model", owned_by: "mock" }] })
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body = await request.json() as { messages?: { role: string; content?: unknown }[] }
      captured = (body.messages ?? []).filter(message => message.role === "system").map(message => typeof message.content === "string" ? message.content : "").join("\n\n")
      return new Response(new ReadableStream({
        start(controller) {
          const send = (line: string) => controller.enqueue(new TextEncoder().encode(line))
          send(chunk({ role: "assistant", content: "" }))
          send(chunk({ content: "ok" }))
          send(chunk({}, "stop"))
          send("data: [DONE]\n\n")
          controller.close()
        },
      }), { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true), text: () => captured }
}

describe("host compatibility and unload", () => {
  test("an untested host is refused, and allowUntestedHost runs it with a warning in the status", async () => {
    const refused = fakeRuntimes(), allowed = fakeRuntimes()
    const untested = await startHost([
      createPlugin({ createRuntime: refused.create, packageRoot }),
      { id: "test.allowed", setup: (ctx: Plugin.Context) => createPlugin({ createRuntime: allowed.create, packageRoot }).setup({ ...ctx, options: { allowUntestedHost: true } }) },
      observer,
    ], "2.3.0")
    try {
      const location = { directory: project("untested", {}) }
      await untested.sdk.agent.list({ location })
      expect(untested.logs.some(log => log.text.includes("HOST_UNTESTED: Utilities supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode 2.2.3, 2.2.4, 2.2.5 or 2.2.6, or set the plugin option allowUntestedHost: true"))).toBe(true)
      expect(refused.created).toHaveLength(0)
      expect(allowed.created).toHaveLength(1)
      const status = await untested.sdk.rpc(Utilities).status({}, { location })
      expect(status.host).toMatchObject({ version: "2.3.0", range: ">=2.2.3 <2.3.0", tested: false, next: expect.stringContaining("allowUntestedHost is set") })
      expect(status.state).toBe("ready")
    } finally { await untested.sdk.close() }
  })

  test("unloading closes every runtime and its availability subscription", async () => {
    await host.sdk.close()
    closed = true
    expect(runtimes.created.length).toBeGreaterThan(0)
    for (const created of runtimes.created) expect([created.closed, created.listenerCount()]).toEqual([true, 0])
  })
})

async function waitFor(check: () => Promise<boolean>, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the host")
    await Bun.sleep(50)
  }
}
