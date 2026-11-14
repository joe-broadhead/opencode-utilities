import { afterEach, describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { DEPRECATED_IDS, MODULES } from "../../src/domain/contract.js"
import { deprecatedNote, markAliasCalled, resetAliases } from "../../src/host/deprecated.js"
import { registerScripting } from "../../src/host/scripting.js"

afterEach(() => resetAliases())

describe("the ids before the rename", () => {
  test("are removed in 0.1.0, which the CHANGELOG names too", () => {
    expect(DEPRECATED_IDS.removedIn).toBe("0.1.0")
    expect(readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8")).toContain("`utilities.tools` and `utilities.tools.tools`, are removed in 0.1.0")
  })

  test("the status note names the release that removes them", () => {
    expect(deprecatedNote()).toBeUndefined()
    markAliasCalled("tools")
    expect(deprecatedNote()).toBe("Deprecated id called: utilities.tools.tools. Use utilities.local.tools instead; the old id works until 0.1.0, which removes it.")
  })

  test("the old tools RPC's describe names the new id and the release that removes the old one", async () => {
    const registered = new Map<string, Record<string, (raw: unknown, context: never) => Promise<unknown>>>()
    const ctx = {
      location: { directory: "/project" },
      rpc: {
        register: async (contract: { id: string }, handlers: Record<string, (raw: unknown, context: never) => Promise<unknown>>) => {
          registered.set(contract.id, handlers)
          return { dispose: async () => {} }
        },
      },
    }
    let called = 0
    await registerScripting(ctx as never, { modules: () => Object.fromEntries(MODULES.map((module) => [module, { availability: "AVAILABLE" }])) } as never, () => void called++).catch(() => undefined)
    const alias = registered.get(DEPRECATED_IDS.tools)
    expect(alias).toBeDefined()
    const described = (await alias!.describe!({}, undefined as never)) as { deprecated?: string }
    expect(described.deprecated).toBe("use utilities.local.tools; removed in 0.1.0")
    expect(called).toBe(1)
  })
})
