// Imports the installed package's ./server entry from the empty project that install.spec.ts built, and prints what it
// exports. OpenCode provides @opencode/plugin to plugins, so this process serves that import from the repository's dev
// install as a virtual module; every other import, the plugin's own files included, must resolve inside the project.
// Usage: bun test/pack/probe.ts <project>
import { plugin } from "bun"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const [project] = process.argv.slice(2)
if (!project) throw new Error("usage: bun test/pack/probe.ts <project>")
const repo = fileURLToPath(new URL("../../", import.meta.url))
const NAME = "@we-the-rebel-alliance/utilities-plugin"
const installed = join(project, "node_modules", NAME)

const HOST_MODULES = /^(?:@opencode\/plugin)(?:\/.*)?$/
const scanner = new Bun.Transpiler({ loader: "js" })
const specifiers = new Set(scanner.scanImports(await Bun.file(join(installed, "dist/index.js")).text())
  .map(i => i.path).filter(path => HOST_MODULES.test(path)))
const served = await Promise.all([...specifiers].map(async specifier => [specifier, await import(Bun.resolveSync(specifier, repo))] as const))
plugin({
  name: "opencode-host-modules",
  setup(build) {
    for (const [specifier, exports] of served) build.module(specifier, () => ({ exports, loader: "object" }))
  },
})

const server = (await import(join(installed, "dist/index.js"))).default

console.log(JSON.stringify({
  served: [...specifiers].sort(),
  server: { id: server.id, setup: typeof server.setup, path: join(installed, "dist/index.js") },
}))
