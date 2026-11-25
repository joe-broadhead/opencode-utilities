import { describe, expect, test } from "vitest"
import * as z from "zod"
import { assertHost } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "../../src/handlers/index.js"
import { manifest, version } from "../../src/manifest.js"
import type { Provider } from "../../src/provider/index.js"

/** A provider that is never called: this suite checks the table and its schemas. */
const provider = new Proxy({} as Provider, { get: () => async () => { throw new Error("the table is not run here") } })
const handlers = createHandlers({ provider, manifest, version, hostVersion: "2.4.1", access: "all", skillProblems: [] })

describe("the manifest and the handler table", () => {
  test("declare the same methods, and nothing else", () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(manifest.methods).sort())
    expect(Object.keys(manifest.methods)).toHaveLength(29)
  })
  test("every method is accounts: none, and no handler input declares an account", () => {
    for (const [name, item] of Object.entries(manifest.methods)) {
      expect(item.accounts, name).toBe("none")
      const properties = (handlers[name]!.input as { properties?: Record<string, unknown> }).properties ?? {}
      expect(Object.hasOwn(properties, "account"), name).toBe(false)
    }
  })
  test("the classes are the ones the manifest states", () => {
    const expected: Record<string, string> = {
      status: "read", diagnose: "read", sessions: "read", sessions_grep: "read",
      timer_set: "write", timer_delete: "delete", speech_synthesize: "export",
      native_install: "admin", speech_install: "admin",
    }
    for (const [name, item] of Object.entries(manifest.methods)) expect(item.class, name).toBe(expected[name] ?? "read")
    expect(Object.values(manifest.methods).filter(item => item.class !== "read")).toHaveLength(5)
  })
  test("nothing is pinned, and no pass-through MCP method is declared", () => {
    expect(Object.values(manifest.methods).some(item => item.pinned === true)).toBe(false)
    expect(Object.keys(manifest.methods).filter(name => name.startsWith("mcp:"))).toEqual([])
  })
  test("every handler has a description and two schemas the register can check", () => {
    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler.description.length, name).toBeGreaterThan(20)
      const input = handler.input as Record<string, unknown>
      expect(input["type"], name).toBe("object")
      expect(() => z.fromJSONSchema(handler.input as never), name).not.toThrow()
      expect(() => z.fromJSONSchema(handler.output as never), name).not.toThrow()
    }
  })
  test("no input schema carries a pattern: OpenCode 2.4.1 disables them", () => {
    const patterns = (value: unknown): number => {
      if (Array.isArray(value)) return value.reduce<number>((n, item) => n + patterns(item), 0)
      if (value === null || typeof value !== "object") return 0
      return Object.entries(value).reduce((n, [key, held]) => n + (key === "pattern" ? 1 : 0) + patterns(held), 0)
    }
    for (const [name, handler] of Object.entries(handlers)) {
      expect(patterns(handler.input), name).toBe(0)
      expect(patterns(handler.output), name).toBe(0)
    }
  })
  test("the manifest declares no accounts, sources or actions, and only changed", () => {
    expect(manifest.accounts).toBeUndefined()
    expect(manifest.sources).toEqual([])
    expect(manifest.actions).toEqual([])
    expect(Object.keys(manifest.events)).toEqual(["changed"])
  })
})

describe("the host gate", () => {
  const context = (host: string, options: Record<string, unknown> = {}) => ({ app: { version: host }, options })
  test("a tested release starts", () => {
    expect(() => assertHost(context("2.4.1"), manifest)).not.toThrow()
  })
  test("another 2.4 release inside the range starts", () => {
    expect(() => assertHost(context("2.4.9"), manifest)).not.toThrow()
  })
  test("an untested release refuses with HOST_UNTESTED and a next step", () => {
    let thrown: Error | undefined
    try { assertHost(context("2.5.0"), manifest) } catch (error) { thrown = error as Error }
    expect(thrown?.message).toMatch(/^HOST_UNTESTED: /)
    expect(thrown?.message).toContain("Next step: ")
    expect(thrown?.message).toContain("allowUntestedHost")
  })
  test("allowUntestedHost starts it anyway", () => {
    expect(() => assertHost(context("2.5.0", { allowUntestedHost: true }), manifest)).not.toThrow()
  })
})
