// Builds dist/ with esbuild: one self-contained file, dist/index.js, with all first-party code and zod inlined, no
// chunks and no relative imports, so an in-place update can never mix a new entry with a cached old sibling module.
// No declarations ship. Run it with `node scripts/build.mjs` (npm run build).
//
// Sources import zod as `import * as z`. A named `import { z }` makes the bundler keep every locale.
import { build } from "esbuild"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const dist = join(root, "dist")
// The host provides this module to plugins at run time, so it stays an import. Nothing else may stay external.
const HOST = ["@opencode/plugin", "@opencode/plugin/*"]
// A runtime built-in: `bun:sqlite`, which sessions_grep imports dynamically so a Node unit test can inject a database.
const BUILTIN = ["bun:sqlite"]
const allowed = path => path.startsWith("node:") || BUILTIN.includes(path) || HOST.some(name => name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name)

// A bundle is only half the plugin: the native files and the manifest that pins them are the other half, and they are
// build outputs that a checkout does not carry. A dist/ without them loads and then refuses every tool that needs a
// program, so the build says so first, before it touches dist/, with the step that produces them.
if (!existsSync(join(root, "manifest", "native.json"))) {
  console.warn(
    "NATIVE_FILES_MISSING: manifest/native.json is not there, so this build's time and weather tools refuse to run. " +
      "Next step: Run npm run native:ensure, then npm run build. The build continues.",
  )
}
rmSync(dist, { recursive: true, force: true })
const result = await build({
  absWorkingDir: root,
  entryPoints: { index: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: [...HOST, ...BUILTIN],
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
})

const outputs = Object.keys(result.metafile.outputs).sort()
if (JSON.stringify(outputs) !== JSON.stringify(["dist/index.js"])) {
  console.error(`BUILD_OUTPUTS: the build wrote ${outputs.join(", ")}. Next step: Keep exactly dist/index.js, with splitting off.`)
  process.exit(1)
}
const unexpected = Object.entries(result.metafile.outputs).flatMap(([file, output]) => output.imports.filter(entry => entry.external && !allowed(entry.path)).map(entry => `${file}: ${entry.path}`))
if (unexpected.length) {
  console.error(`BUILD_EXTERNAL: ${unexpected.join(", ")} would be imported at run time but is neither bundled nor provided by the host. Next step: Bundle it, or remove the import.`)
  process.exit(1)
}

// NOTICE carries the licence of every package inlined into dist/, from the bundle's own inputs. The build fails when
// the checked-in NOTICE no longer matches; `node scripts/build.mjs --notice` rewrites it.
const inlined = new Set()
for (const output of Object.values(result.metafile.outputs)) for (const input of Object.keys(output.inputs)) {
  const name = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]
  if (name) inlined.add(name)
}
const notices = [...inlined].sort().map(name => {
  const dir = join(root, "node_modules", name), { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const file = readdirSync(dir).find(file => /^licen[cs]e(?:\.md|\.txt)?$/i.test(file))
  if (!file) throw new Error(`NOTICE_MISSING: ${name} ships no licence file`)
  return `## ${name} ${version} (${license}), in dist/index.js\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`
})
const notice = `@we-the-rebel-alliance/utilities-plugin bundles this third-party code into dist/.\n\n${notices.join("\n")}`
const noticePath = join(root, "NOTICE")
if (process.argv.includes("--notice")) writeFileSync(noticePath, notice)
else if (!existsSync(noticePath) || readFileSync(noticePath, "utf8") !== notice) {
  console.error("NOTICE_MISMATCH: NOTICE does not match the packages bundled into dist/. Next step: Run node scripts/build.mjs --notice, then commit NOTICE.")
  process.exit(1)
}
