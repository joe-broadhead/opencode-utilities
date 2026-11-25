// The skills on the real embedded OpenCode 2.4.1 host: the built bundle registers its five skills through
// `ctx.skill.transform`, and a malformed file is skipped (and reported in status) instead of failing setup.
//
// The bundle is `dist/index.js`, the artifact the check builds (`npm run check` builds before it tests). A plain
// `npm test` without one builds it once here, so the test never depends on a stale checkout. The host must not read the
// user's own OpenCode state, so HOME, the XDG variables and TMPDIR point at a temporary root before anything under
// `@opencode/*` is imported; every such import is dynamic, after that setup.
import { afterAll, describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const bundle = join(repo, "dist", "index.js")
if (!existsSync(bundle)) execFileSync(process.execPath, [join(repo, "scripts", "build.mjs")], { cwd: repo, stdio: "ignore" })

const root = realpathSync(mkdtempSync(join(repo, "test", ".skills-host-")))
const home = join(root, "home")
for (const directory of [home, join(home, ".config"), join(home, ".local/share"), join(home, ".cache"), join(home, ".local/state"), join(root, "tmp")]) mkdirSync(directory, { recursive: true })
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
const previous = process.cwd()
process.chdir(home)
afterAll(() => {
  process.chdir(previous)
  rmSync(root, { recursive: true, force: true })
})

const SKILLS = ["utilities", "utilities-time", "utilities-weather", "utilities-speech", "utilities-sessions"] as const

const description = (name: string) => {
  const text = readFileSync(join(repo, "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n")
  const front = /^---\n([\s\S]*?)\n---/.exec(text)![1]!
  const line = front.split("\n").find(entry => entry.startsWith("description:"))!
  return line.slice("description:".length).trim()
}

/** A copy of the installed package: the built bundle, its manifest, and the five skills, one of them broken if named. */
function packageCopy(name: string, broken?: string): string {
  const directory = join(root, name)
  mkdirSync(join(directory, "dist"), { recursive: true }); mkdirSync(join(directory, "skills"), { recursive: true })
  cpSync(bundle, join(directory, "dist", "index.js"))
  cpSync(join(repo, "package.json"), join(directory, "package.json"))
  if (existsSync(join(repo, "manifest"))) cpSync(join(repo, "manifest"), join(directory, "manifest"), { recursive: true })
  for (const skill of SKILLS) {
    const to = join(directory, "skills", skill, "SKILL.md")
    mkdirSync(dirname(to), { recursive: true })
    if (skill === broken) writeFileSync(to, `---\nname: ${skill}\n---\nThis file has no description.\n`)
    else cpSync(join(repo, "skills", skill, "SKILL.md"), to)
  }
  return directory
}

/** One SDK host with the plugin at `entry`, on the isolated home, and the skill list after activation. */
async function skillsOf(entry: string, directory: string) {
  const { OpenCode } = await import("@opencode/sdk")
  const plugin = (await import(`${pathToFileURL(entry).href}?v=${encodeURIComponent(entry)}`)).default
  const host = await OpenCode.create({
    app: { name: "opencode", version: "2.4.1" },
    plugins: [plugin],
    database: { path: join(root, `opencode-${Math.random().toString(16).slice(2)}.db`) },
    models: { fetch: false },
    fs: { filewatcher: false },
    config: { directory },
    log: { level: "error", emit: () => undefined },
  })
  try {
    const session = await host.sessions.create({ location: { directory }, agent: "build" })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the utilities plugin", delivery: "queue" }).catch(() => undefined)
    // Wait, with a bound, for the host to acquire the plugin before asking what it registered.
    const until = Date.now() + 20_000
    for (;;) {
      const active = await host.plugin.list({ location: { directory } }).then((list: { data: { id: string }[] }) => list.data.some(item => item.id === "utilities"), () => false)
      if (active || Date.now() > until) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const skills = await host.skill.list({ location: { directory } })
    return { host, sessionID: session.id, skills: skills.data }
  } catch (error) {
    await host.close().catch(() => undefined)
    throw error
  }
}

describe("the skills on the real host", () => {
  test("the built plugin registers utilities and the four topic skills, with their descriptions", async () => {
    const packageRoot = packageCopy("package")
    const directory = join(root, "project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { host, skills } = await skillsOf(join(packageRoot, "dist/index.js"), directory)
    try {
      const found = skills.filter((skill: { id: string }) => (SKILLS as readonly string[]).includes(skill.id))
      expect(found.map((skill: { id: string }) => skill.id).sort()).toEqual([...SKILLS].sort())
      for (const skill of found) expect(skill.description, skill.id).toBe(description(skill.id))
      expect(found.every((skill: { autoinvoke?: boolean }) => skill.autoinvoke === true), "autoinvoke").toBe(true)
    } finally { await host.close() }
  }, 120_000)

  test("a malformed skill is skipped, reported in status, and setup still succeeds", async () => {
    const packageRoot = packageCopy("broken-package", "utilities-time")
    const directory = join(root, "broken-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { host, sessionID, skills } = await skillsOf(join(packageRoot, "dist/index.js"), directory)
    try {
      const ids = skills.map((skill: { id: string }) => skill.id)
      expect(ids).toContain("utilities")
      expect(ids).not.toContain("utilities-time")
      for (const name of ["utilities-weather", "utilities-speech", "utilities-sessions"]) expect(ids).toContain(name)
      const answer = await host.rpc.call({ rpcID: "utilities", method: "status", input: { sessionID, input: {} }, location: { directory } })
      const status = answer.output as { state: string; nextStep: string | null }
      expect(status.state).toBe("error")
      expect(String(status.nextStep)).toContain("utilities-time skill was not loaded")
    } finally { await host.close() }
  }, 120_000)
})
