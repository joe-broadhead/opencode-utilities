import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "../../src/handlers/index.js"
import { manifest, version } from "../../src/manifest.js"
import type { Provider } from "../../src/provider/index.js"
import { calendar } from "../fixtures.js"

/**
 * The conformance evidence: `fixtures/conformance.json`, recorded from the plugin's own handlers. It holds the status
 * answer, the one bus event a write emits, the namespace text and a valid input for each non-read method, which T1 uses
 * to reach the permission gate. Regenerate it with `UPDATE_FIXTURES=1 npm test`; the test fails when it drifts.
 */
const file = fileURLToPath(new URL("../../fixtures/conformance.json", import.meta.url))

/** The provider's answers, as the recorded status and the recorded write see them. */
const provider: Provider = {
  invoke: async () => calendar,
  runtimeStatus: async () => ({
    platform: { target: "linux-x64-gnu", availability: "AVAILABLE" },
    modules: { time: { availability: "AVAILABLE" }, weather: { availability: "AVAILABLE" }, speech: { availability: "AVAILABLE" } },
    speech: { assets: [], voices: ["Luna"], preseeded: false, cacheDirectory: "/cache", outputDirectory: "/state/speech" },
    timers: { directory: "/state/projects/0/timers", due: 0 },
  }),
  weatherStatus: async () => ({ tier: "free", key: "none", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" }),
  settleWeather: async () => {},
  sessions: async () => { throw new Error("not recorded") },
  grep: async () => { throw new Error("not recorded") },
  installNatives: async () => ({ downloaded: [], bytes: 0, cacheDirectory: "/cache" }),
  installSpeech: async () => ({ downloaded: [], bytes: 0, cacheDirectory: "/cache" }),
  close: async () => {},
}

const handlers = createHandlers({ provider, manifest, version, hostVersion: "2.4.1", access: "all" })

/** One handler call, with only what the recorded methods read. */
function call(emitted: string[]): Pick<MethodCall, "account" | "signal" | "unguardedAgents" | "bus"> {
  return {
    account: "default",
    signal: new AbortController().signal,
    unguardedAgents: async () => ({ ok: true as const, agents: [] }),
    bus: {
      name: "utilities",
      emit: async (event: string) => { emitted.push(event); return { ok: true as const, event } },
    } as unknown as MethodCall["bus"],
  }
}

/** The inputs T1 needs to reach the permission gate of each non-read method without running it. The recorder redacts the
 * timer name as personal data, so the fixture carries its placeholder and this test uses the same value. */
const RPC_INPUTS = {
  timer_set: { name: "<redacted:personal>", deadline: "2027-01-01T00:00:00Z" },
  timer_delete: { name: "<redacted:personal>" },
  speech_synthesize: { text: "hello" },
}

describe("conformance fixture", () => {
  test("matches what the handlers answer", async () => {
    const emitted: string[] = []
    const status = await handlers["status"]!.run({}, call(emitted) as MethodCall)
    await handlers["timer_set"]!.run(RPC_INPUTS.timer_set, call(emitted) as MethodCall)
    const recorded = {
      $comment: "Recorded from the plugin's own handlers: the status answer, the one bus event a write emits, and a valid input per non-read method. Regenerate with UPDATE_FIXTURES=1 npm test.",
      plugin: "@we-the-rebel-alliance/utilities-plugin",
      events: { emitted: [...new Set(emitted)].sort(), status },
      rpc: { inputs: RPC_INPUTS },
      namespace: manifest.plugin.summary,
    }
    if (process.env["UPDATE_FIXTURES"] === "1") writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(recorded)
  })
})
