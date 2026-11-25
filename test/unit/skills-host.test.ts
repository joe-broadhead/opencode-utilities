// Every `skills/` directory registers on the real embedded OpenCode 2.4.1 host, with its description and autoinvoke.
// The expected ids come from the directories at test time; see test/support/skills-host.ts for the isolated home.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, description, packageCopy, skillsOf, SKILLS, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("the skills on the real host", () => {
  test("the built plugin registers every skills/ directory, with its description and autoinvoke", () => {
    expect(SKILLS.length).toBeGreaterThan(0)
    const packageRoot = packageCopy("package")
    const directory = join(root, "project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    const found = skills.filter(skill => SKILLS.includes(skill.id))
    expect(found.map(skill => skill.id).sort()).toEqual([...SKILLS].sort())
    for (const skill of found) expect(skill.description, skill.id).toBe(description(skill.id))
    expect(found.every(skill => skill.autoinvoke === true), "autoinvoke").toBe(true)
  }, 120_000)
})
