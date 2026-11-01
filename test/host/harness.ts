// Hosts Utilities in-process on the public @opencode/sdk. Import this module before anything that loads
// @opencode/*: it points HOME, OPENCODE_TEST_HOME, the XDG variables and TMPDIR at a temporary root, and
// changes into that root, so the host never reads or writes the user's real OpenCode state. Under Bun,
// os.homedir() ignores a HOME changed after startup, which is why OPENCODE_TEST_HOME is set too.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { OpenCode } from "@opencode/sdk"

/** The host version reported to plugins. Read before the environment is replaced. */
export const HOST_VERSION = process.env.OPENCODE_HOST_VERSION ?? "2.2.3"
export const root = realpathSync(mkdtempSync(join(tmpdir(), "utilities-host-")))
const home = join(root, "home")
const previousDir = process.cwd()
for (const dir of [home, join(home, ".config"), join(home, ".local/share"), join(home, ".cache"), join(home, ".local/state"), join(root, "tmp")]) mkdirSync(dir, { recursive: true })
for (const name of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT"]) delete process.env[name]
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local/state"),
  TMPDIR: join(root, "tmp"),
})
// The embedded host also opens a location at the working directory.
process.chdir(home)

/** A project directory with its own opencode.json. */
export function project(name: string, config: object) {
  const directory = join(root, "projects", name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "opencode.json"), JSON.stringify(config))
  return directory
}

let count = 0
/** Starts an embedded host. `logs` collects its warnings and errors, such as a plugin's setup failure. */
export async function startHost(plugins: readonly Plugin.Plugin[], version = HOST_VERSION) {
  const { OpenCode } = await import("@opencode/sdk")
  const { Global } = await import("@opencode/util/global")
  const paths = Global.Path as { data: string; cache: string; config: string; state: string; tmp: string; home: string; bin: string; log: string; repos: string }
  const outside = Object.entries({ data: paths.data, cache: paths.cache, config: paths.config, state: paths.state, tmp: paths.tmp, home: paths.home, bin: paths.bin, log: paths.log, repos: paths.repos, cwd: process.cwd() })
    .filter(([, path]) => !path.startsWith(root + sep))
  if (outside.length > 0) throw new Error(`refusing to start: OpenCode paths are outside the test root: ${outside.map(([name, path]) => `${name}=${path}`).join(", ")}`)
  const logs: { level: string; message: string; text: string }[] = []
  const sdk = await OpenCode.create({
    app: { version },
    plugins,
    database: { path: join(root, `opencode-${++count}.db`) },
    models: { fetch: false },
    fs: { filewatcher: false },
    config: { claude: false },
    log: { level: "warn", emit: (entry: OpenCode.LogEntry) => logs.push({ level: entry.level, message: entry.message, text: `${entry.message} ${String(entry.cause ?? "")} ${JSON.stringify(entry.attributes ?? {})}` }) },
  })
  return { sdk, logs }
}

export function removeRoot() {
  try { process.chdir(previousDir) } catch { /* the previous directory may already be gone */ }
  rmSync(root, { recursive: true, force: true })
}
