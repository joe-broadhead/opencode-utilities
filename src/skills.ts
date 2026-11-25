import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Skill, type Plugin } from "@opencode/plugin"

/**
 * The skills this package ships, in `skills/<name>/SKILL.md`. OpenCode 2.4.1 does not scan an installed plugin
 * package's `skills/` folder: its roots are the config and agent directories, and `ctx.skill.transform` is the only
 * loader a plugin has. So the files are read here and registered in setup; the contract has no skill wiring.
 */
export const SKILL_NAMES = ["utilities", "utilities-time", "utilities-weather", "utilities-speech", "utilities-sessions"] as const

/** One skill's failure, in the contract's one-line form, with the file and the step that fixes it. */
const notLoaded = (name: string, detail: string) => `The ${name} skill was not loaded: skills/${name}/SKILL.md ${detail}. Next step: reinstall the plugin, or fix the file in a checkout and restart OpenCode.`

/**
 * Parses `---` front matter with `name` and `description`; the body after it is the skill's content. A file that breaks
 * these rules throws the reason, and `loadSkills` records it instead of failing setup.
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
  return {
    id: Skill.ID.make(name),
    name: Skill.Name.make(name),
    description,
    autoinvoke: true,
    path: Skill.Info.fields.path.make(path),
    content: match[2]!.trim(),
  }
}

/**
 * Reads every skill the package ships. A missing or malformed file never stops the plugin, because the methods and the
 * access rules still work: it is skipped and reported in status and diagnose instead.
 */
export async function loadSkills(directory: string): Promise<{ readonly skills: readonly Skill.Info[]; readonly problems: readonly string[] }> {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  for (const name of SKILL_NAMES) {
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

/** Register the parsed skills on the host's skill domain. The transform runs once, when the plugin loads. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform(editor => {
    for (const info of skills) editor.add(info)
  })
}
