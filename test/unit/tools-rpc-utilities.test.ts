// Utilities' part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts and the methods in
// src/host/scripting.ts. The shared part is tested in tools-rpc.test.ts.
import { describe, expect, test, vi } from "vitest"
import { MODULES, TOOLS, type Availability, type StatusView, type ToolName } from "../../src/domain/contract.js"
import { UtilitiesError } from "../../src/domain/common.js"
import { SCRIPT_EFFECTS, SCRIPT_TOOLS, scriptMethods } from "../../src/host/scripting.js"
import { KNOWN_READS, NEXT_STEPS, pluginError, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { failure } from "../host/runtime.js"
import { INPUTS, SAMPLES } from "../host/samples.js"

const modulesWith = (availability: Partial<Record<(typeof MODULES)[number], Availability>>) =>
  Object.fromEntries(MODULES.map(m => [m, { availability: availability[m] ?? "AVAILABLE" }])) as StatusView["modules"]
const call = { sessionID: "ses_1", agent: "build", messageID: "msg_script", id: "script:1", signal: new AbortController().signal, progress: async () => {} }

function methods(modules = modulesWith({})) {
  const invoke = vi.fn(async (tool: ToolName) => SAMPLES[tool as Exclude<ToolName, "status">])
  const settle = vi.fn(async () => {})
  return { invoke, settle, methods: scriptMethods({ runtime: { invoke }, weather: { settle }, status: async () => { throw new Error("not used") }, modules: () => modules }) }
}

describe("Utilities' tools RPC", () => {
  test("is utilities.tools.tools, with no MCP reads", () => {
    expect(TOOLS_RPC_ID).toBe("utilities.tools.tools")
    expect(KNOWN_READS).toEqual([])
  })

  test("its methods are exactly the 22 tools that change nothing; timer writes and speech synthesis never are", () => {
    expect([...SCRIPT_TOOLS]).toEqual([
      "status", "time_now", "time_zones", "time_zone_info", "time_convert", "time_calendar", "time_add", "time_between", "time_format", "time_holidays", "time_business_days",
      "timer_get", "timer_list", "timer_check",
      "weather_geocode", "weather_current", "weather_daily", "weather_hourly", "weather_demand_signal", "weather_summary",
      "speech_cleanup", "speech_transcribe",
    ])
    const excluded = (Object.keys(TOOLS) as ToolName[]).filter(name => !SCRIPT_TOOLS.includes(name))
    expect(excluded).toEqual(["timer_set", "timer_delete", "speech_synthesize"])
    // By effect, so a tool added later that writes is never a method.
    for (const name of excluded) expect(SCRIPT_EFFECTS.has(TOOLS[name].effect)).toBe(false)
    expect([...SCRIPT_EFFECTS].sort()).toEqual(["compute", "network", "read-file", "read-state"])
  })

  test("each method carries the tool's permission action and its schemas as plain JSON Schema", () => {
    for (const method of methods().methods) {
      expect(method.action).toBe(`utilities_${method.name}`)
      expect(method.description.length).toBeGreaterThan(60)
      expect(JSON.parse(JSON.stringify(method.input))).toEqual(method.input)
      expect(JSON.parse(JSON.stringify(method.output))).toEqual(method.output)
      // An object, or a choice of objects for tools with modes (time_holidays, time_business_days).
      expect(method.input["type"] === "object" || Array.isArray(method.input["oneOf"]) || Array.isArray(method.input["anyOf"])).toBe(true)
    }
  })

  test("a method checks its input with the tool's schema, then runs the tool as the call", async () => {
    const { invoke, methods: list } = methods()
    const timeNow = list.find(method => method.name === "time_now")!
    expect(await timeNow.run(INPUTS.time_now, call)).toEqual(SAMPLES.time_now.output)
    expect(invoke).toHaveBeenCalledWith("time_now", { ...INPUTS.time_now, format: "rfc3339" }, call)
    await expect(timeNow.run({ timezones: "UTC", extra: true }, call)).rejects.toMatchObject({ code: "INPUT_INVALID" })
    await expect(list.find(method => method.name === "status")!.run({ extra: true }, call)).rejects.toMatchObject({ code: "INPUT_INVALID" })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  test("a weather method reports a rejected Open-Meteo key, as the tool does", async () => {
    const { invoke, settle, methods: list } = methods()
    invoke.mockRejectedValueOnce(failure("WEATHER_KEY_REJECTED", "Open-Meteo rejected the key."))
    const weather = list.find(method => method.name === "weather_current")!
    await expect(weather.run(INPUTS.weather_current, call)).rejects.toMatchObject({ code: "WEATHER_KEY_REJECTED" })
    await weather.run(INPUTS.weather_current, call)
    expect(settle.mock.calls).toEqual([[true], [false]])
  })

  test("available() follows the tool list: unavailable with the module's code exactly when the model's tool is not registered", () => {
    const reasons = (modules: StatusView["modules"]) => Object.fromEntries(methods(modules).methods.map(method => [method.name, method.available?.()]))
    expect(Object.values(reasons(modulesWith({}))).every(reason => reason === undefined)).toBe(true)
    const off = reasons(modulesWith({ weather: "DISABLED", time: "PLATFORM_PACKAGE_MISSING", speech: "UNSUPPORTED_PLATFORM" }))
    expect(off.status).toBeUndefined()
    expect(off.time_now).toBe("PLATFORM_PACKAGE_MISSING")
    expect(off.timer_check).toBe("PLATFORM_PACKAGE_MISSING")
    expect(off.weather_current).toBe("DISABLED")
    expect(off.speech_transcribe).toBe("UNSUPPORTED_PLATFORM")
    // Cleanup needs no engine; transcription stays available while only its files are missing, as the tool stays registered.
    expect(off.speech_cleanup).toBeUndefined()
    expect(reasons(modulesWith({ speech: "SPEECH_ASSETS_MISSING" })).speech_transcribe).toBeUndefined()
  })

  test("pluginError gives a Utilities failure's code, message and next step, and leaves every other error alone", () => {
    expect(pluginError(new UtilitiesError("TIMER_NOT_FOUND"))).toEqual({ code: "TIMER_NOT_FOUND", what: "No timer with that name exists in this project.", next: "Call utilities_timer_list to see this project's timers." })
    expect(pluginError(Object.assign(new Error("Permission denied: x"), { _tag: "Tool.Error", code: "X" }))).toBeUndefined()
    expect(pluginError(new Error("plain"))).toBeUndefined()
    expect(pluginError(failure("OPERATION_FAILED", "Something failed."))).toMatchObject({ code: "OPERATION_FAILED", next: expect.stringMatching(/\.$/) })
  })

  test("has no per-account servers, and every next step names Utilities' own surface", () => {
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
    for (const next of Object.values(NEXT_STEPS)) expect(next).not.toMatch(/tavily|connect and choose/i)
  })
})
