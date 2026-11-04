import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { NAMESPACE, SPEECH_DOWNLOAD_ACTION, TOOLS, WEATHER_INTEGRATION } from "../../src/domain/contract.js"
import { DEFAULT_RULES } from "../../src/host/permissions.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. So each declared effect must be the one these rules give the tool after a
 * base allow, and the declared skills must be the ones the package ships.
 */

type Tool = { name: string; permission: string; effect: string; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
const jelly = pkg.jelly as {
  title: string
  summary: string
  icon: string
  tools: Tool[]
  skills: string[]
  rpc: unknown[]
  views: unknown[]
  signIns: unknown[]
  contributes: Record<string, unknown[]>
}
// The drawing elements Jelly's icon cleaner keeps (hey-jelly `plugin-icon.ts`). It drops a whole icon that has any
// other element, so a `<title>` is refused too.
const ICON_ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs"])
for (const name of ["linearGradient", "radialGradient", "stop", "clipPath", "mask"]) ICON_ELEMENTS.add(name)
const rules: readonly { action: string; resource: string; effect: string }[] = [{ action: "*", resource: "*", effect: "allow" }, ...DEFAULT_RULES]
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`)
const effectOf = (action: string) => [...rules].reverse().find((rule) => wildcard(rule.action).test(action) && rule.resource === "*")?.effect

describe("the jelly declaration", () => {
  it("gives each tool the effect the plugin's own default rules give it", () => {
    expect(jelly.tools.length).toBeGreaterThan(0)
    for (const tool of jelly.tools) expect(effectOf(tool.permission), tool.permission).toBe(tool.effect)
  })

  it("names each tool once, as the engine names its permission (namespace.tool for namespace_tool)", () => {
    const names = jelly.tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of jelly.tools) expect(tool.name.replaceAll(".", "_"), tool.name).toBe(tool.permission)
  })

  it("declares every tool and the speech download, marking read-only exactly those that write no state or file", () => {
    const known = new Map<string, boolean>(
      Object.entries(TOOLS).map(([name, tool]): [string, boolean] => [`${NAMESPACE}_${name}`, tool.effect !== "write-state" && tool.effect !== "write-file"]),
    )
    known.set(SPEECH_DOWNLOAD_ACTION, false)
    const declared = new Map(jelly.tools.map((tool) => [tool.permission, tool.readOnly]))
    expect([...declared.keys()].sort()).toEqual([...known.keys()].sort())
    for (const [permission, readOnly] of known) expect(declared.get(permission), permission).toBe(readOnly)
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

  it("declares no RPC methods, views or contributions, and no keys Jelly's declaration schema does not accept", () => {
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  it("has a summary of one line, 1 to 120 characters", () => {
    expect(jelly.summary.trim().length).toBeGreaterThan(0)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
    expect(jelly.summary).not.toContain("\n")
  })

  it("has the icon assets/icon.svg, shipped, with one svg root, xmlns and viewBox, only drawing elements, under 16 KB", () => {
    expect(jelly.icon).toBe("assets/icon.svg")
    expect(pkg.files).toContain(jelly.icon)
    const svg = readFileSync(new URL(`../../${jelly.icon}`, import.meta.url), "utf8").trim()
    expect(svg.length).toBeLessThanOrEqual(16_384)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="[^"]+"/)
    expect(svg.endsWith("</svg>")).toBe(true)
    expect(svg).not.toMatch(/<title|<style|<script|&|<!/i)
    const elements = [...svg.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1])
    expect(elements.filter((name) => !ICON_ELEMENTS.has(name!))).toEqual([])
  })

  it("names every skill the package ships", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
  })
})
