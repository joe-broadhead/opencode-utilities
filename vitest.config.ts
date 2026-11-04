import { defineConfig } from "vitest/config"
// passWithNoTests: the shared tools-rpc test registers its MCP-only tests with a plain `if`, so a plugin without an
// MCP server, like this one, has suites with no tests, which vitest otherwise fails. Every file is still listed in
// `include`, and each suite with tests still runs them all.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], passWithNoTests: true, testTimeout: 20000 } })
