// Imports the installed package's main and ./tui entries from the empty project that install.spec.ts
// built, and prints what they export. OpenCode provides @opencode/plugin, effect, OpenTUI and Solid to plugins, so
// this process serves exactly those imports from the repository's dev install as virtual modules; every other
// import, the plugin's own files included, must resolve inside the project.
// Usage: bun test/pack/probe.ts <project> [platform package]
import { plugin } from "bun"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const [project, platformPackage] = process.argv.slice(2)
if (!project) throw new Error("usage: bun test/pack/probe.ts <project> [platform package]")
const repo = fileURLToPath(new URL("../../", import.meta.url))
const NAME = "@joe-broadhead/opencode-utilities"
const installed = join(project, "node_modules", NAME)

const HOST_MODULES = /^(?:@opencode\/plugin|effect|@opentui\/[^/]+|solid-js)(?:\/.*)?$/
const scanner = new Bun.Transpiler({ loader: "js" })
const specifiers = new Set(readdirSync(join(installed, "dist")).filter(file => file.endsWith(".js"))
  .flatMap(file => scanner.scanImports(readFileSync(join(installed, "dist", file), "utf8")).map(i => i.path).filter(path => HOST_MODULES.test(path))))
const served = await Promise.all([...specifiers].map(async specifier => [specifier, await import(Bun.resolveSync(specifier, repo))] as const))
plugin({
  name: "opencode-host-modules",
  setup(build) {
    for (const [specifier, exports] of served) build.module(specifier, () => ({ exports, loader: "object" }))
  },
})

const entry = async (subpath: string) => import(Bun.resolveSync(subpath ? `${NAME}/${subpath}` : NAME, project))
const server = (await entry("")).default
const tui = (await entry("tui")).default
// The runtime finds the binaries the same way, from the installed package root.
const platform = platformPackage ? dirname(createRequire(join(installed, "package.json")).resolve(`${platformPackage}/package.json`)) : undefined

console.log(JSON.stringify({
  served: [...specifiers].sort(),
  server: { id: server.id, setup: typeof server.setup, path: Bun.resolveSync(NAME, project) },
  tui: { id: tui.id, setup: typeof tui.setup },
  platform,
}))
