// Hosts Utilities in-process on the public @opencode/sdk. Import this module before anything that loads
// @opencode/*: it points HOME, OPENCODE_TEST_HOME, the XDG variables and TMPDIR at a temporary root, and
// changes into that root, so the host never reads or writes the user's real OpenCode state. Under Bun,
// os.homedir() ignores a HOME changed after startup, which is why OPENCODE_TEST_HOME is set too.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Plugin } from "@opencode/plugin"
import type { OpenCode } from "@opencode/sdk"

/** The repository root, from this file, so a changed HOME or working directory does not move it. */
const REPO = fileURLToPath(new URL("../..", import.meta.url))

/**
 * The version of the embedded host. `HOST_SDK_DIR` names another `@opencode/sdk` installed outside the lockfile, which
 * is how `npm run test:host` runs the suite once per tested release; unset, it is the locked SDK.
 */
const SDK = process.env.HOST_SDK_DIR
  ? join(realpathSync(process.env.HOST_SDK_DIR), "node_modules", "@opencode", "sdk")
  : join(REPO, "node_modules/@opencode/sdk")
export const HOST_VERSION = (JSON.parse(readFileSync(join(SDK, "package.json"), "utf8")) as { version: string }).version

/**
 * A harness artefact, not a host property. The embedded SDK does not install OpenCode's plugin runtime, so a plugin's
 * own `@opencode/plugin` (here the locked 2.2.3 dev dependency) is a second copy next to the versioned SDK's from 2.2.4
 * on. `toolError` in `@opencode/plugin/dist/promise/adapter.js` compares with `instanceof`, which fails across the two
 * copies, and wraps the error as `new Tool.Error({ message, error })`, so the plugin's metadata lands on
 * `error.error.metadata`. A stock binary serves every plugin the host's own `@opencode/plugin`, so real installs keep
 * `error.metadata` on every release; the review's tool-error-copies finding proves that on stock 2.2.3, 2.3.0 and 2.3.2.
 * The accessor only adapts to the copy the harness produced.
 */
export const NESTED_TOOL_ERROR = ((major, minor, patch) => major > 2 || (major === 2 && (minor > 2 || (minor === 2 && patch >= 4))))(
  ...(HOST_VERSION.split(".").map(Number) as [number, number, number]),
)

/** A tool failure's metadata, read from the copy the harness produced: on the error up to 2.2.3, one level down from 2.2.4. */
export const toolErrorMetadata = (error: unknown) => {
  const failure = error as { metadata?: unknown; error?: { metadata?: unknown } } | undefined
  return NESTED_TOOL_ERROR ? failure?.error?.metadata : failure?.metadata
}

/**
 * From OpenCode 2.3.1, `experimental.automation` replaces `experimental.schedule`, and a code action no longer runs when
 * it is created: it runs when the scheduler finds it due.
 */
export const AUTOMATIONS = ((major, minor, patch) => major > 2 || (major === 2 && (minor > 3 || (minor === 3 && patch >= 1))))(
  ...(HOST_VERSION.split(".").map(Number) as [number, number, number]),
)

/** The embedded SDK's interface, which carries `close`. */
type SdkClient = Awaited<ReturnType<(typeof import("@opencode/sdk"))["OpenCode"]["create"]>>

/**
 * The SDK's host, loaded from `SDK` by path so `HOST_SDK_DIR` really runs that release's SDK, not the locked one a bare
 * `@opencode/sdk` import resolves to. From 2.3.1 it is the same embedded host, with its own Automation service also
 * running the scheduler, as `opencode serve` does (only a server process starts it): `PromiseSdk.create` is what
 * `OpenCode.create` calls, here with the SDK's `overrides`. The modules sit next to the SDK, so they are the instances
 * its bundle imports.
 */
async function createSdk(options: Parameters<(typeof import("@opencode/sdk"))["OpenCode"]["create"]>[0]): Promise<SdkClient> {
  const load = (...path: string[]) => import(pathToFileURL(join(...path)).href)
  if (!AUTOMATIONS) return ((await load(SDK, "dist", "index.js")) as typeof import("@opencode/sdk")).OpenCode.create(options) as Promise<SdkClient>
  const modules = join(SDK, "..", "..")
  const { PromiseSdk } = await load(SDK, "dist", "promise.js")
  const { Automation } = await load(modules, "@opencode", "core", "dist", "automation.js")
  const { Effect, Layer } = await load(modules, "effect", "dist", "index.js")
  const scheduling = Automation.node.mapLayer((layer: unknown) =>
    Layer.effect(
      Automation.Service,
      Effect.gen(function* () {
        const automations = yield* Automation.Service
        yield* Effect.forkScoped(automations.run)
        return automations
      }),
    ).pipe(Layer.provide(layer)),
  )
  return PromiseSdk.create(options, { overrides: [Automation.node.replace(scheduling)] }) as Promise<SdkClient>
}
// Never under the real home: OpenCode searches upward for .opencode/ folders, which would bring in the user's own
// agents and skills. /private/tmp on macOS; the system temp folder elsewhere.
const realHome = realpathSync(homedir())
const root = realpathSync(mkdtempSync(join(existsSync("/private/tmp") ? "/private/tmp" : tmpdir(), "utilities-host-")))
if (root === realHome || root.startsWith(realHome + sep)) throw new Error(`refusing to start: the test root ${root} is inside the home directory`)
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
  const { Global } = await import("@opencode/util/global")
  const paths = Global.Path as { data: string; cache: string; config: string; state: string; tmp: string; home: string; bin: string; log: string; repos: string }
  const outside = Object.entries({ data: paths.data, cache: paths.cache, config: paths.config, state: paths.state, tmp: paths.tmp, home: paths.home, bin: paths.bin, log: paths.log, repos: paths.repos, cwd: process.cwd() })
    .filter(([, path]) => !path.startsWith(root + sep))
  if (outside.length > 0) throw new Error(`refusing to start: OpenCode paths are outside the test root: ${outside.map(([name, path]) => `${name}=${path}`).join(", ")}`)
  const logs: { level: string; message: string; text: string }[] = []
  const sdk = await createSdk({
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

/** How OpenCode answered a program run with nobody present: it ran and returned, or its message. */
export type Unattended = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** The part of the `experimental.automation` client of 2.3.1 and later used here; the checks compile against 2.2.3. */
interface Automations {
  create(input: { sessionID: string; name: string; trigger: { type: "at"; at: string }; action: { type: "code"; code: string } }): Promise<{ id: string }>
  get(input: { automationID: string }): Promise<{ lastOutcome?: string; lastOutput?: string }>
  delete(input: { automationID: string }): Promise<unknown>
}

/** A schedule check returned a boolean or `{ wake }`; an automation returns nothing, so the program is wrapped. */
const asCheck = (code: string) =>
  `const checked = await (async () => {\n${code}\n})()\nif (typeof checked !== "boolean" && !(typeof checked === "object" && checked !== null && typeof checked.wake === "boolean")) throw new Error("A code check must return a boolean or { wake, state?, message? }")`

/** How long the poll waits for an automation's run: shorter than the suite's 60 s test timeout, so the message below is what fails. */
const RUN_DEADLINE_MS = 45_000

/**
 * Runs a Code Mode program once with nobody present to answer a prompt, as the session's agent and under its rules,
 * with no model, and answers as a schedule's `if: { code }` check did at creation up to 2.3.0: `ok` when the program
 * returned a boolean or `{ wake }`, else OpenCode's message (a refusal, or what the program threw). Up to 2.3.0 it is
 * that check, and the schedule is deleted at once. From 2.3.1 it is an automation's code action, due at once:
 * creation refuses what the rules do not allow, as the check did, and the run's outcome is read back before the
 * automation is deleted. A run that never comes throws, so it is never read as a refusal.
 */
export async function unattended(host: Awaited<ReturnType<typeof startHost>>, sessionID: string, code: string): Promise<Unattended> {
  const name = "utilities-host-test"
  const refused = (error: unknown): Unattended => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
  if (!AUTOMATIONS) {
    try {
      const schedule = await host.sdk.experimental.schedule.create({ sessionID, name, when: { in: "6 hours" }, if: { code }, prompt: "never wakes" } as never)
      await host.sdk.experimental.schedule.delete({ scheduleID: schedule.id })
      return { ok: true }
    } catch (error) {
      return refused(error)
    }
  }
  const automations = (host.sdk.experimental as unknown as { automation: Automations }).automation
  let automationID: string
  try {
    automationID = (await automations.create({ sessionID, name, trigger: { type: "at", at: "in 1 millis" }, action: { type: "code", code: asCheck(code) } })).id
  } catch (error) {
    return refused(error)
  }
  try {
    const deadline = Date.now() + RUN_DEADLINE_MS
    let run: { lastOutcome?: string; lastOutput?: string } | undefined
    while (run === undefined) {
      const info = await automations.get({ automationID })
      if (info.lastOutcome !== undefined) run = info
      else if (Date.now() > deadline) throw new Error("timed out waiting until the automation's code action has run (is the host's Automation scheduler forked? see the harness's createSdk)")
      else await Bun.sleep(50)
    }
    if (run.lastOutcome === "fired" || run.lastOutcome === "late") return { ok: true }
    // A program that cannot succeed on a retry (a bad return value, a scoped ask) pauses its automation.
    if (run.lastOutcome === "failed") return { ok: false, error: (run.lastOutput ?? "").replace(/^Paused: /, "") }
    throw new Error(`the automation's code action ended "${run.lastOutcome}": ${run.lastOutput ?? ""}`)
  } finally {
    await automations.delete({ automationID })
  }
}

export function removeRoot() {
  try { process.chdir(previousDir) } catch { /* the previous directory may already be gone */ }
  rmSync(root, { recursive: true, force: true })
}
