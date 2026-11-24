// The legacy declaration key in package.json (`jelly`), which an app reads without loading the plugin. That app's
// agents have no base "allow everything" rule, so this plugin's own default rules never reach them; it writes each
// declared "ask" or "deny" as that tool's default instead. The key stays until the plugin kit replaces it, so the
// declaration stays tested: four skills and 26 tools.
//
// Two checks of the shared kit are not run here. `declarationProblems` asserted the pre-rename
// `@joe-broadhead/opencode-<name>` package name, which the pinned test/support/jelly-kit.ts cannot drop here, and it also
// checked the declaration's unknown keys, title, summary, icons and files; `docProblems` asserted docs/jelly.md, which the
// rebuild deletes. Those fields are unchecked until 4b. Do not restore the old package-name rule.
import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/domain/config.js"
import { ACCESS_VALUES, NAMESPACE, TOOLS, WEATHER_INTEGRATION } from "../../src/domain/contract.js"
import { type Declaration, type DeclaredTool, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const declaration = pkg.jelly as Declaration & { rpc: unknown[]; views: unknown[]; contributes: Record<string, unknown[]> & { settings: PluginSetting[] }; tools: DeclaredTool[] }
const known = new Map<string, boolean>(
  Object.entries(TOOLS).map(([name, tool]): [string, boolean] => [`${NAMESPACE}_${name}`, tool.effect !== "write-state" && tool.effect !== "write-file"]),
)

describe("the legacy declaration", () => {
  it("declares exactly the tools the plugin registers, no more and no fewer, each permission equal to its action name", () => {
    const declared = declaration.tools.map(tool => tool.name).sort()
    const registered = Object.keys(TOOLS).map(name => `${NAMESPACE}.${name}`).sort()
    expect(declared).toEqual(registered)
    for (const tool of declaration.tools) expect(tool.permission, tool.name).toBe(tool.name.replaceAll(".", "_"))
    expect(declaration.tools.map(tool => tool.permission).sort()).toEqual([...known.keys()].sort())
  })

  it("marks read-only exactly the tools that write no state or file", () => {
    for (const tool of declaration.tools) expect(tool.readOnly, tool.permission).toBe(known.get(tool.permission))
  })

  it("declares the optional Open-Meteo key, with a link to where it comes from", () => {
    expect(declaration.signIns).toEqual([
      {
        id: "open-meteo",
        label: "Open-Meteo",
        integration: WEATHER_INTEGRATION,
        required: false,
        help: { url: "https://open-meteo.com/en/pricing", label: "Commercial use needs a key from Open-Meteo" },
      },
    ])
  })

  it("declares the flat access option, with the declaration's own words for its three values, and no RPC methods, views or other contributions", () => {
    expect(declaration.rpc).toEqual([])
    expect(declaration.views).toEqual([])
    expect(declaration.contributes).toEqual({
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

  it("the settings follow the declaration schema's rules for a declared setting", () => {
    expect(settingsProblems(declaration.contributes.settings)).toEqual([])
  })

  it("the options parser takes every declared access choice, its default included, and refuses a value outside them", () => {
    const access = declaration.contributes.settings.find(setting => setting.key === "access")!
    const values = (settingChoices(access) ?? []).map(choice => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) expect<string>(loadConfig({ access: value }).access).toBe(value)
    expect<string>(loadConfig({}).access).toBe(access.default as string)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => loadConfig({ access: "write" })).toThrow("OPTIONS_INVALID")
  })
})
