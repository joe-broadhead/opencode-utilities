// Block-scalar descriptions are read as their text, not as `>`, `|`, `>-` or `|-`, on the real embedded OpenCode
// 2.4.1 host. The host runs on an empty temporary project in a fresh process, so the answer comes from the plugin's
// registration alone.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, packageCopy, skillsOf, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("a block-scalar description on the real host", () => {
  test("registers the folded, literal and stripped text, never the marker", () => {
    const cases: readonly [string, string, string][] = [
      ["utilities", ">", "first line second line\n"],
      ["utilities-time", "|", "first line\nsecond line\n"],
      ["utilities-weather", ">-", "first line second line"],
      ["utilities-speech", "|-", "first line\nsecond line"],
    ]
    const packageRoot = packageCopy("folded-package")
    for (const [id, marker, expected] of cases) {
      expect(expected, `${id} sanity`).not.toBe(marker)
      writeFileSync(join(packageRoot, "skills", id, "SKILL.md"), `---\nname: ${id}\ndescription: ${marker}\n  first line\n  second line\n---\n\n# Body\n`)
    }
    const directory = join(root, "folded-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    for (const [id, marker, expected] of cases) {
      const skill = skills.find(candidate => candidate.id === id)
      expect(skill, `the host registered ${id}`).toBeDefined()
      expect(skill!.description, `${id} (${marker})`).toBe(expected)
      expect(skill!.description, `${id} is not its marker`).not.toBe(marker)
    }
  }, 120_000)
})
