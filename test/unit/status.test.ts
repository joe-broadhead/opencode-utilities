import { describe, expect, test } from "vitest"
import { RegisterError } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "../../src/handlers/index.js"
import { UtilitiesError } from "../../src/domain/common.js"
import { manifest, version } from "../../src/manifest.js"
import type { Provider } from "../../src/provider/index.js"
import type { RuntimeStatus } from "../../src/domain/contract.js"
import { calendar } from "../fixtures.js"

const runtime: RuntimeStatus = {
  platform: { target: "linux-x64-gnu", availability: "AVAILABLE" },
  modules: { time: { availability: "AVAILABLE" }, weather: { availability: "AVAILABLE" }, speech: { availability: "AVAILABLE" } },
  speech: { assets: [{ role: "engine", name: "engine", bytes: 1, state: "cached" }], voices: ["Luna"], preseeded: false, cacheDirectory: "/cache", outputDirectory: "/state/speech" },
  timers: { directory: "/state/timers", due: 2, next: "Call tools.utilities.timer_check to see the due timers." },
}
function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    invoke: async () => calendar,
    runtimeStatus: async () => runtime,
    weatherStatus: async () => ({ tier: "free", key: "none", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" }),
    settleWeather: async () => {},
    sessions: async () => { throw new UtilitiesError("OPERATION_FAILED") },
    grep: async () => { throw new UtilitiesError("OPERATION_FAILED") },
    installNatives: async () => ({ downloaded: [], bytes: 0, cacheDirectory: "/cache" }),
    installSpeech: async () => ({ downloaded: [], bytes: 0, cacheDirectory: "/cache" }),
    close: async () => {},
    ...overrides,
  }
}
const handlers = (overrides: Partial<Provider> = {}) => createHandlers({ provider: provider(overrides), manifest, version, hostVersion: "2.4.1", access: "all" })
type Unguarded = { readonly ok: true; readonly agents: readonly string[] } | { readonly ok: false; readonly error: string }
function call(emitted: { event: string; data: unknown }[] = [], agents: () => Promise<Unguarded> = async () => ({ ok: true, agents: [] })) {
  return {
    account: "default",
    signal: new AbortController().signal,
    unguardedAgents: agents,
    bus: { emit: async (event: string, data: unknown) => { emitted.push({ event, data }); return { ok: true as const } } },
  } as never
}

describe("status", () => {
  test("is the contract's answer: identity, host range, no accounts, and the unguarded agents", async () => {
    const answer = await handlers()["status"]!.run({}, call([], async () => ({ ok: true, agents: ["locked"] })))
    expect(answer).toEqual({
      name: "utilities",
      version: "0.0.0",
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [],
      unguardedAgents: ["locked"],
      nextStep: null,
    })
  })
  test("an agent list that cannot be read is unknown, never zero: state is error with a redacted next step", async () => {
    const answer = await handlers()["status"]!.run({}, call([], async () => ({ ok: false, error: "the agent list failed with ghp_token_value_that_is_long_enough_to_mask" })))
    expect(answer).toMatchObject({ state: "error" })
    expect(String((answer as { nextStep: string }).nextStep)).toContain("the agent list failed")
    expect(String((answer as { nextStep: string }).nextStep)).not.toContain("ghp_token_value_that_is_long_enough_to_mask")
    expect((answer as { unguardedAgents: string[] }).unguardedAgents).toEqual([])
  })
})

describe("diagnose", () => {
  test("reports every module, the weather tier, the timers and each stopgap's criterion", async () => {
    const answer = await handlers()["diagnose"]!.run({}, call()) as Record<string, unknown>
    expect(answer).toMatchObject({
      version: "0.0.0",
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: true },
      state: "ready",
      access: "all",
      platform: { target: "linux-x64-gnu", availability: "AVAILABLE" },
      timers: { directory: "/state/timers", due: 2 },
    })
    expect((answer["stopgaps"] as { tool: string }[]).map(stopgap => stopgap.tool)).toEqual(["utilities_sessions", "utilities_sessions_grep"])
    expect(answer["nextStep"]).toBe("Call tools.utilities.timer_check to see the due timers.")
  })
  test("a failed module with no usable sibling is state failed", async () => {
    const failed = await handlers({
      runtimeStatus: async () => ({
        ...runtime,
        modules: { time: { availability: "UNSUPPORTED_PLATFORM", next: "No build." }, weather: { availability: "UNSUPPORTED_PLATFORM", next: "No build." }, speech: { availability: "DISABLED" } },
        speech: { ...runtime.speech, assets: [] },
        timers: { directory: "/state/timers" },
      }),
    })["diagnose"]!.run({}, call()) as Record<string, unknown>
    expect(failed["state"]).toBe("failed")
    expect(failed["nextStep"]).toBe("No build.")
  })
})

describe("writes and the bus", () => {
  test("a timer write emits changed for utilities.timers as the default alias", async () => {
    const emitted: { event: string; data: unknown }[] = []
    await handlers()["timer_set"]!.run({ name: "review", deadline: "2027-01-01T00:00:00Z" }, call(emitted))
    expect(emitted).toEqual([{ event: "changed", data: { capability: "utilities.timers", account: "default", reason: "write" } }])
  })
  test("a speech install emits changed for utilities.speech", async () => {
    const emitted: { event: string; data: unknown }[] = []
    await handlers()["speech_install"]!.run({}, call(emitted))
    expect(emitted).toEqual([{ event: "changed", data: { capability: "utilities.speech", account: "default", reason: "install" } }])
  })
  test("a failed emit never fails the write", async () => {
    const answer = await handlers()["timer_delete"]!.run({ name: "review" }, {
      account: "default", signal: new AbortController().signal,
      bus: { emit: async () => { throw new Error("the host is gone") } },
    } as never)
    expect(answer).toEqual(calendar)
  })
})

describe("refusals", () => {
  test("a provider failure becomes a RegisterError on the contract's table, keeping its own code and next step", async () => {
    const error = await handlers({ invoke: async () => { throw new UtilitiesError("TIME_AMBIGUOUS") } })["time_convert"]!
      .run({ datetime: "2026-10-25T02:30", from_timezone: "Europe/Amsterdam", to_timezone: "UTC" }, call())
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(RegisterError)
    const refusal = (error as RegisterError).refusal
    expect(refusal.code).toBe("INPUT_INVALID")
    expect(refusal.what).toContain("TIME_AMBIGUOUS")
    expect(refusal.next).toContain("offset")
  })
  test("an unknown error passes through for the register to map to UNAVAILABLE", async () => {
    const original = new Error("something else")
    const error = await handlers({ invoke: async () => { throw original } })["time_now"]!.run({}, call()).catch((thrown: unknown) => thrown)
    expect(error).toBe(original)
  })
})
