// The README, the docs and the shipped code are one contract: the default rules, the error codes, the tested releases
// and the scripting examples must match the source. A drift fails this file; run `UPDATE_DOCS=1 npm test` to
// regenerate the README's two generated blocks from the source.
import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defaultRules } from "../../src/host/permissions.js"
import { FAILURES } from "../../src/domain/common.js"
import { ACCESS_VALUES, DEFAULT_ASK, TOOLS } from "../../src/domain/contract.js"
import { NEXT_STEPS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { HOST_RANGE, TESTED_HOSTS, TESTED_TEXT } from "../../src/host/versions.js"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8")
const UPDATE = process.env.UPDATE_DOCS === "1"

/** Every module of the repository, in a stable order. */
function walk(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(`${ROOT}${dir}`, { withFileTypes: true })
    .flatMap(entry => {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(path, extensions)
      return extensions.some(extension => entry.name.endsWith(extension)) ? [path] : []
    })
    .sort()
}

const SOURCES = walk("src", [".ts", ".tsx"])
const TESTS = walk("test", [".ts", ".tsx"])
const DOCS = walk("docs", [".md"])
const README_FILES = ["README.md", "AGENTS.md", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md"]

/** Replace a generated block with `body`, or compare it when nothing is being regenerated. */
function checkBlock(file: string, name: string, body: string) {
  const open = `<!-- generated:${name} -->`
  const close = `<!-- /generated:${name} -->`
  const text = read(file)
  const start = text.indexOf(open)
  const end = text.indexOf(close)
  expect({ file, name, markers: start !== -1 && end > start }).toEqual({ file, name, markers: true })
  const expected = `${text.slice(0, start + open.length)}\n\n${body}\n\n${text.slice(end)}`
  if (UPDATE) {
    if (expected !== text) writeFileSync(`${ROOT}${file}`, expected)
    return
  }
  expect(text, `${file}: the ${name} block is stale; run UPDATE_DOCS=1 npm test`).toBe(expected)
}

/** The block for one access value: one row per rule, in the order the transform inserts them. */
const rulesBody = (access: (typeof ACCESS_VALUES)[number]) => () =>
  [
    `\`access: "${access}"\``,
    "",
    "| Action | Resource | Effect |",
    "| --- | --- | --- |",
    ...defaultRules(access).map(rule => `| \`${rule.action}\` | \`${rule.resource}\` | \`${rule.effect}\` |`),
  ].join("\n")

/** Every code the plugin can report: its own failures, and the refusals the tools RPC adds. */
const CODES = [...new Set([...Object.keys(FAILURES), ...Object.keys(NEXT_STEPS)])].sort()

/** What happened, and the next step, from the one table: the same words an error message carries. */
const storyOf = (code: string): readonly [string, string] =>
  Object.hasOwn(FAILURES, code)
    ? [FAILURES[code as keyof typeof FAILURES][0], FAILURES[code as keyof typeof FAILURES][1] ?? "Nothing further."]
    : ["The tools RPC refused the call.", NEXT_STEPS[code as keyof typeof NEXT_STEPS]!]

const codesBody = () =>
  ["| Code | What happened | Next step |", "| --- | --- | --- |", ...CODES.map(code => { const [what, next] = storyOf(code); return `| \`${code}\` | ${what} | ${next} |` })].join("\n")

describe("the README's generated blocks", () => {
  test("each access value's block is the block the plugin inserts after each agent's base allow", () => {
    for (const access of ACCESS_VALUES) checkBlock("README.md", `rules-${access}`, rulesBody(access)())
    // Every tool runs at `all`, and the namespace rule covers a tool a later release adds.
    expect(defaultRules("all").every(rule => rule.effect === "allow")).toBe(true)
    expect(defaultRules("all")[0]).toEqual({ action: "utilities_*", resource: "*", effect: "allow" })
    for (const access of ["ask-changes", "read-only"] as const) {
      const block = defaultRules(access), effect = access === "ask-changes" ? "ask" : "deny"
      expect(block[0]).toEqual({ action: "utilities_*", resource: "*", effect })
      // The namespace first, then the four changes; every read is allowed.
      expect(block.filter(rule => rule.effect !== "allow").map(rule => rule.action)).toEqual(["utilities_*", ...DEFAULT_ASK])
    }
  })

  test("the code table is the code table: every code, in both directions", () => {
    checkBlock("README.md", "codes", codesBody())
    const table = new Set(CODES)
    const readme = read("README.md")
    expect([...table].filter(code => !readme.includes(`\`${code}\``))).toEqual([])
    // Every code the source raises as a literal has an entry, so a new code cannot ship undocumented.
    const raised = new Set<string>()
    for (const path of SOURCES) {
      // The shared tools RPC module declares every code any plugin may raise; this plugin's own sites are elsewhere.
      if (path.endsWith("src/host/tools-rpc.ts")) continue
      const text = read(path)
      for (const match of text.matchAll(/\b(?:fail|failure|error|reason)\(\s*"([A-Z][A-Z0-9_]{2,})"/g)) raised.add(match[1]!)
      for (const match of text.matchAll(/"(?:code|reason)":\s*"([A-Z][A-Z0-9_]{2,})"/g)) raised.add(match[1]!)
    }
    // NATIVE_* are the shared release-program installer's codes (src/process/install.ts). refuse() in src/domain/backends.ts
    // maps each to a code in the table before any tool reports it.
    expect([...raised].filter(code => !table.has(code) && !code.startsWith("NATIVE_"))).toEqual([])
    // A code written into a message string ("CODE: what happened") is a code too. Comments that show the shape are not.
    for (const path of SOURCES) {
      if (path.endsWith("src/host/tools-rpc.ts")) continue
      for (const line of read(path).split("\n")) {
        const trimmed = line.trim()
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue
        for (const match of line.matchAll(/[`"']([A-Z][A-Z0-9_]{2,}): /g)) raised.add(match[1]!)
      }
    }
    expect([...raised].filter(code => !table.has(code) && !code.startsWith("NATIVE_"))).toEqual([])
  })
})

describe("the tested releases", () => {
  test("every tested-host mention is TESTED_HOSTS, in the same order", () => {
    for (const file of [...README_FILES, ...DOCS]) {
      const text = read(file)
      for (const match of text.matchAll(/tested on ([0-9][0-9.,\s]*(?:and\s+[0-9][0-9.]*)?)/g)) {
        const said = match[1]!.replace(/[.,\s]+$/u, "").split(/,\s*|\s+and\s+/).map(part => part.trim()).filter(Boolean)
        expect({ file, said }).toEqual({ file, said: TESTED_HOSTS })
      }
    }
  })

  test("the words and the range match the list", () => {
    expect(TESTED_TEXT).toBe(`OpenCode ${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`)
    expect(HOST_RANGE).toBe(">=2.2.3 <2.3.0")
    expect(TESTED_HOSTS).toContain("2.2.6")
  })

  test("the Unreleased section states no tested release it has not run on", () => {
    const unreleased = read("CHANGELOG.md").split(/^## \[/m).find(section => section.startsWith("[Unreleased]")) ?? ""
    expect(unreleased).not.toMatch(/2\.2\.[0-5]\b(?!.*2\.2\.6)/)
  })
})

test("no shipped text carries internal wording", () => {
  const banned = [/\bowner'?s? (decision|ruling)\b/iu, /\bthe lead\b/iu, /\blane\b/iu, /hey-jelly #/iu, /\b(?:G[1-4]|W2|R1[0-7])\b/u, /\bthe (?:audit|reconcile) (?:lane|group)\b/iu]
  for (const file of [...README_FILES, ...DOCS, ...SOURCES, ...TESTS]) {
    // This file names the banned words; it is the rule, not shipped text.
    if (file === "test/unit/docs.test.ts") continue
    const text = read(file)
    for (const pattern of banned) expect({ file, pattern: String(pattern), hit: pattern.test(text) }).toEqual({ file, pattern: String(pattern), hit: false })
  }
})

describe("docs/scripting.md", () => {
  const text = read("docs/scripting.md")
  const rpc = (method: string) => `/api/rpc/${TOOLS_RPC_ID}/${method}`

  test("names the shipped RPC id and the plugin's namespace", () => {
    expect(text).toContain(`\`${TOOLS_RPC_ID}\``)
    expect(text).toContain('x-opencode-directory:$PWD')
  })

  test("every call has the location header and the envelope, and names a method the plugin has", () => {
    const calls = [...text.matchAll(/opencode api post (\/api\/rpc\/[^\s\\]+)([^\n]*)/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const [, url, rest] of calls) {
      const prefix = `/api/rpc/${TOOLS_RPC_ID}/`
      expect(url!.startsWith(prefix)).toBe(true)
      expect({ url, header: rest!.includes('-H "x-opencode-directory:$PWD"') }).toEqual({ url, header: true })
      const method = url!.slice(prefix.length)
      // The envelope line is the template, with `<method>` standing for one.
      if (method.startsWith("<")) continue
      expect({ method, known: method === "describe" || Object.hasOwn(TOOLS, method) }).toEqual({ method, known: true })
    }
    for (const match of text.matchAll(/-d '(\{"input":\{[\s\S]*?\}\})'/g)) {
      // The envelope line is a template: its `…` stands for the caller's input.
      if (match[1]!.includes("…")) continue
      const body = JSON.parse(match[1]!) as { input: Record<string, unknown> }
      expect(Object.keys(body)).toEqual(["input"])
      expect(Object.keys(body.input).filter(key => key !== "sessionID" && key !== "input")).toEqual([])
      // `describe` takes nothing at all; a method call needs the session.
      if (Object.keys(body.input).length === 0) continue
      expect(typeof body.input["sessionID"]).toBe("string")
    }
    expect(text).toContain(rpc("describe"))
    expect(text).toContain(rpc("time_now"))
    expect(text).toContain(rpc("timer_check"))
  })

  test("documents every shipped method", () => {
    for (const name of Object.keys(TOOLS)) expect(text).toContain(`\`${name}\``)
  })
})
