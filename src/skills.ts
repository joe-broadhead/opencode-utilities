import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Skill, type Plugin } from "@opencode/plugin"

/**
 * The skills this package ships, in `skills/<name>/SKILL.md`. OpenCode 2.4.1 does not scan an installed plugin
 * package's `skills/` folder: its roots are the config and agent directories, and `ctx.skill.transform` is the only
 * loader a plugin has. So every directory under `skills/` is read here and registered in setup; the contract has no
 * skill wiring.
 */

/** One skill's failure, with the code, the file and the step that fixes it. It never fails setup. */
const notLoaded = (name: string, detail: string) => `SKILLS_INVALID: The ${name} skill was not loaded: skills/${name}/SKILL.md ${detail}. Next step: reinstall the plugin, or fix the file in a checkout and restart OpenCode.`

/** The skills folder itself could not be listed: one problem, and no skills, rather than a failed setup. */
const folderUnreadable = (detail: string) => `SKILLS_INVALID: The skills folder was not read: ${detail}. Next step: reinstall the plugin.`

/**
 * Parses `---` front matter with `name` and `description`; the body after it is the skill's content, which must be
 * non-empty. A file that breaks these rules throws the reason, and `loadSkills` records it instead of failing setup.
 */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const fail = (detail: string): never => { throw new Error(notLoaded(name, detail)) }
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (match === null) return fail("has no front matter")
  const fields = new Map(match[1]!.split("\n").map(line => {
    const at = line.indexOf(":")
    return [at < 0 ? line.trim() : line.slice(0, at).trim(), at < 0 ? "" : line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, "$2")]
  }))
  if (fields.get("name") !== name) return fail(`must be named ${name} in its front matter`)
  const description = fields.get("description")
  if (description === undefined || description === "") return fail("has no description")
  if (/^[>|]/.test(description)) return fail("has a YAML block scalar description, which this loader does not fold; write the description on one line")
  const content = match[2]!.trim()
  if (content === "") return fail("has an empty body")
  return {
    id: Skill.ID.make(name),
    name: Skill.Name.make(name),
    description,
    autoinvoke: true,
    path: Skill.Info.fields.path.make(path),
    content,
  }
}

/**
 * Reads every skill directory the package ships, in name order. A missing or malformed file never stops the plugin,
 * because the methods and the access rules still work: it is skipped and reported in status and diagnose instead.
 */
export async function loadSkills(directory: string): Promise<{ readonly skills: readonly Skill.Info[]; readonly problems: readonly string[] }> {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { skills, problems: [folderUnreadable(code === "ENOENT" ? "it is missing" : `it cannot be read (${code ?? "unknown"})`)] }
  }
  for (const name of entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      problems.push(code === undefined ? (error instanceof Error ? error.message : notLoaded(name, "could not be read")) : notLoaded(name, code === "ENOENT" ? "is missing" : `cannot be read (${code})`))
    }
  }
  return { skills, problems }
}

/**
 * Register the parsed skills on the host's skill domain. `register` builds nothing for skills, so this is the one call
 * that puts them in front of an agent; it runs once, after `register`, when the plugin loads.
 */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform(editor => {
    for (const info of skills) editor.add(info)
  })
}
