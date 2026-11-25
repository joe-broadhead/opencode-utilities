// Shared setup for the real-host skill tests. Each test file runs in its own vitest worker, so importing this module
// sets an isolated HOME, the XDG variables and TMPDIR before anything under `@opencode/*` is loaded; the SDK itself is
// imported dynamically inside `skillsOf`. The expected skills come from the `skills/` directories on disk, never a
// hardcoded list, so a new skill directory is never missed.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

export const repo = fileURLToPath(new URL("../../", import.meta.url))
const bundle = join(repo, "dist", "index.js")
if (!existsSync(bundle)) throw new Error("dist/ is missing: run npm run bundle first")

export const root = realpathSync(mkdtempSync(join(repo, "test", ".skills-host-")))
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
process.chdir(home)

export function cleanup(): void {
  rmSync(root, { recursive: true, force: true })
}

/** The skills the package ships, read from `skills/` at test time. */
export const SKILLS: readonly string[] = readdirSync(join(repo, "skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(repo, "skills", entry.name, "SKILL.md")))
  .map(entry => entry.name)
  .sort()

/** The description from a SKILL.md's front matter, parsed by a real YAML parser. */
export const description = (name: string) => {
  const text = readFileSync(join(repo, "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n")
  const front = /^---\n([\s\S]*?)\n---/.exec(text)![1]!
  const parsed = parseYaml(front) as { description?: unknown }
  if (typeof parsed.description !== "string") throw new Error(`skills/${name}/SKILL.md has no description`)
  return parsed.description
}

/** A copy of the installed package: the built bundle, its manifest, and every skill. */
export function packageCopy(name: string): string {
  const directory = join(root, name)
  mkdirSync(join(directory, "dist"), { recursive: true }); mkdirSync(join(directory, "skills"), { recursive: true })
  cpSync(bundle, join(directory, "dist", "index.js"))
  cpSync(join(repo, "package.json"), join(directory, "package.json"))
  if (existsSync(join(repo, "manifest"))) cpSync(join(repo, "manifest"), join(directory, "manifest"), { recursive: true })
  for (const skill of SKILLS) {
    const to = join(directory, "skills", skill, "SKILL.md")
    mkdirSync(dirname(to), { recursive: true })
    cpSync(join(repo, "skills", skill, "SKILL.md"), to)
  }
  return directory
}

/**
 * One SDK host in a fresh process, with the plugin at `entry`, on the inherited isolated home: its skills and status.
 * A separate process is what keeps a skill registered by another test's host out of this answer.
 */
export interface HostSkills {
  readonly skills: readonly { id: string; name: string; description?: string; path: string; content: string }[]
  readonly commands: readonly { id?: string; name?: string }[]
  readonly integrations: readonly { id?: string; name?: string }[]
  readonly status: unknown
}

export function skillsOf(entry: string, directory: string): HostSkills {
  const output = execFileSync(process.execPath, [join(repo, "test/support/skills-host-probe.mjs"), entry, directory], { env: process.env, encoding: "utf8", timeout: 120_000 })
  return JSON.parse(output) as HostSkills
}
