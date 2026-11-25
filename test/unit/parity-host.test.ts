// Parity with the last pre-4b release, v0.0.7, checked on the real OpenCode 2.4.1 host: every tool the old release
// declared is still a tool and an RPC method, the three old skills still register, and the deliberately removed
// commands are gone. The old set is read from the v0.0.7 tag and fixed here; the live set comes from the host.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, packageCopy, skillsOf, root } from "../support/skills-host.js"

afterAll(cleanup)

/** The 24 tools the v0.0.7 manifest declared, with the `utilities.` prefix removed. */
const OLD_TOOLS = [
  "status",
  "time_now", "time_zones", "time_zone_info", "time_convert", "time_calendar", "time_add", "time_between", "time_format", "time_holidays", "time_business_days",
  "timer_set", "timer_get", "timer_list", "timer_check", "timer_delete",
  "weather_geocode", "weather_current", "weather_daily", "weather_hourly", "weather_demand_signal", "weather_summary",
  "speech_transcribe", "speech_synthesize",
] as const
/** The 3 skills the v0.0.7 manifest declared. */
const OLD_SKILLS = ["utilities-time", "utilities-weather", "utilities-speech"] as const
/** The commands v0.0.7 registered; all three are deliberately removed in v0.0.8. */
const OLD_COMMANDS = ["utilities-status", "utilities-install", "utilities-speech-install"] as const

describe("parity with v0.0.7 on the real OpenCode 2.4.1 host", () => {
  test("every old tool is still a tool and an RPC method, and the new methods are a superset", async () => {
    const packageRoot = packageCopy("parity")
    const { createHost } = await import("@we-the-rebel-alliance/plugin-contract/kit")
    const run = await createHost({ directory: packageRoot, version: "2.4.1", pluginId: "utilities" })
    try {
      expect(run.failure).toBeUndefined()
      expect(run.refusal).toBeUndefined()
      expect(run.definition?.id).toBe("utilities")
      expect(run.namespace?.name).toBe("utilities")
      const permissions = new Set(run.tools.map(tool => tool.permission))
      const methods = new Set(run.rpc?.methods ?? [])
      for (const name of OLD_TOOLS) {
        expect(permissions, `tool ${name}`).toContain(`utilities.${name}`)
        expect(methods, `rpc ${name}`).toContain(name)
      }
      // The new methods are on top of the old 24: 29 in all.
      for (const name of ["diagnose", "sessions", "sessions_grep", "native_install", "speech_install"]) {
        expect(permissions, `new tool ${name}`).toContain(`utilities.${name}`)
        expect(methods, `new rpc ${name}`).toContain(name)
      }
      expect(run.tools).toHaveLength(29)
      expect(methods.size).toBe(29)
      // The access rules reach every real agent.
      expect(run.agents.length).toBeGreaterThan(0)
      for (const agent of run.agents) expect(agent.permissions.some(rule => rule.action.startsWith("utilities")), agent.id).toBe(true)
    } finally {
      await run.close()
    }
  }, 180_000)

  test("the old skills still register, the old commands are gone, and the Open-Meteo sign-in is wired", () => {
    const packageRoot = packageCopy("parity-probe")
    const directory = join(root, "parity-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills, commands, integrations, status } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    const skillIDs = skills.map(skill => skill.id)
    for (const name of OLD_SKILLS) expect(skillIDs, `skill ${name}`).toContain(name)
    const commandNames = commands.map(command => command.name)
    for (const name of OLD_COMMANDS) expect(commandNames, `command ${name}`).not.toContain(name)
    expect(integrations.some(integration => integration.id === "open-meteo" && integration.name === "Open-Meteo"), "open-meteo sign-in").toBe(true)
    const answer = status as { name: string; accounts: unknown[]; state: string }
    expect(answer.name).toBe("utilities")
    expect(answer.accounts).toEqual([])
    expect(answer.state).toBe("ready")
  }, 120_000)
})
