// Vitest setup. The shared tools-rpc test (test/unit/tools-rpc.test.ts) is a copy of a bun:test file, changed only in
// its imports, so bun's toStartWith matcher is added here rather than in the copy.
import { expect } from "vitest"

expect.extend({
  toStartWith(received: unknown, prefix: string) {
    const pass = typeof received === "string" && received.startsWith(prefix)
    return { pass, message: () => `expected ${JSON.stringify(received)} ${pass ? "not " : ""}to start with ${JSON.stringify(prefix)}` }
  },
})

declare module "vitest" {
  interface Assertion { toStartWith(prefix: string): void }
}
