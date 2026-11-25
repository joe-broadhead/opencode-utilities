// Every `skills/` directory registers on the real embedded OpenCode 2.4.1 host, with the description a real YAML
// parser reads from its front matter (never a block marker), its name, path and body. The host runs on an empty
// temporary project, so nothing is discovered from the package or repository; see test/support/skills-host.ts.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, description, packageCopy, skillsOf, SKILLS, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("the skills on the real host", () => {
  test("the built plugin registers every skills/ directory with its YAML description, name, path and body", () => {
    expect(SKILLS.length).toBeGreaterThan(0)
    const packageRoot = packageCopy("package")
    const directory = join(root, "project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    for (const id of SKILLS) {
      const skill = skills.find(candidate => candidate.id === id)
      expect(skill, `the host registered ${id}`).toBeDefined()
      expect(skill!.name).toBe(id)
      expect(skill!.path).toBe(join(packageRoot, "skills", id, "SKILL.md"))
      expect((skill!.content ?? "").trim().length).toBeGreaterThan(0)
      const expected = description(id)
      expect(skill!.description, `${id} description`).toBe(expected)
      expect(["", ">", "|", ">-", "|-", ">+", "|+"].includes(expected.trim()), id).toBe(false)
    }
  }, 120_000)
})
