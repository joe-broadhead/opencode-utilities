import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/domain/config.js"
import { ACCESS_VALUES, NAMESPACE, TOOLS, WEATHER_INTEGRATION } from "../../src/domain/contract.js"
import { DEFAULT_RULES } from "../../src/host/permissions.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. The shared kit checks the declaration against Jelly's plugin authors'
 * standard; the tests below add what only Utilities declares.
 */

const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { rpc: unknown[]; views: unknown[]; contributes: Record<string, unknown[]> & { settings: PluginSetting[] }; tools: DeclaredTool[] }
const known = new Map<string, boolean>(
  Object.entries(TOOLS).map(([name, tool]): [string, boolean] => [`${NAMESPACE}_${name}`, tool.effect !== "write-state" && tool.effect !== "write-file"]),
)

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(DEFAULT_RULES), registered: [...known.keys()] })).toEqual([])
  })

  it("declares exactly the tools the plugin registers, no more and no fewer", () => {
    const declared = jelly.tools.map(tool => tool.name).sort()
    const registered = Object.keys(TOOLS).map(name => `${NAMESPACE}.${name}`).sort()
    expect(declared.filter(name => !registered.includes(name)), "declared but not registered").toEqual([])
    expect(registered.filter(name => !declared.includes(name)), "registered but not declared").toEqual([])
    expect(jelly.tools.map(tool => tool.permission).sort()).toEqual([...known.keys()].sort())
  })

  it("marks read-only exactly the tools that write no state or file", () => {
    for (const tool of jelly.tools) expect(tool.readOnly, tool.permission).toBe(known.get(tool.permission))
  })

  it("declares the optional Open-Meteo key, with a link to where it comes from", () => {
    expect(jelly.signIns).toEqual([
      {
        id: "open-meteo",
        label: "Open-Meteo",
        integration: WEATHER_INTEGRATION,
        required: false,
        help: { url: "https://open-meteo.com/en/pricing", label: "Commercial use needs a key from Open-Meteo" },
      },
    ])
  })

  it("declares the flat access option, with Jelly's own words for its three values, and no RPC methods, views or other contributions", () => {
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          description: "How much the plugin's tools may do. Generates default rules for agents with a base allow rule.",
          choices: ACCESS_CHOICES,
          default: loadConfig({}).access,
        },
      ],
    })
  })

  it("the settings follow Jelly's rules for a declared setting", () => {
    expect(settingsProblems(jelly.contributes.settings)).toEqual([])
  })

  it("the options parser takes every declared access choice, its default included, and refuses a value outside them", () => {
    const access = jelly.contributes.settings.find(setting => setting.key === "access")!
    const values = (settingChoices(access) ?? []).map(choice => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) expect<string>(loadConfig({ access: value }).access).toBe(value)
    expect<string>(loadConfig({}).access).toBe(access.default as string)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => loadConfig({ access: "write" })).toThrow("OPTIONS_INVALID")
  })
})

describe("docs/jelly.md", () => {
  it("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
