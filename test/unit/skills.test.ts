import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { loadSkills, parseSkill, SKILL_NAMES } from "../../src/skills.js"

describe("the skill loader", () => {
  test("parses name, description and body from a shipped file", () => {
    const name = "utilities-time"
    const path = join(process.cwd(), "skills", name, "SKILL.md")
    const info = parseSkill(name, path, readFileSync(path, "utf8"))
    expect(info.id).toBe(name)
    expect(info.name).toBe(name)
    expect(info.description).toContain("Exact times")
    expect(info.content).toContain("# Time, dates and timers")
    expect(info.autoinvoke).toBe(true)
  })
  test("every shipped skill parses, and there are five", async () => {
    const { skills, problems } = await loadSkills(join(process.cwd(), "skills"))
    expect(problems).toEqual([])
    expect(skills.map(skill => skill.id).sort()).toEqual([...SKILL_NAMES].sort())
  })
  test("a missing, malformed or misnamed file is skipped and recorded, never thrown", async () => {
    const root = mkdtempSync(join(tmpdir(), "utilities-skills-unit-"))
    try {
      for (const name of SKILL_NAMES) {
        const directory = join(root, name); mkdirSync(directory, { recursive: true })
        const body = `---\nname: ${name}\ndescription: A synthetic ${name} skill.\n---\nBody.\n`
        writeFileSync(join(directory, "SKILL.md"), name === "utilities-time" ? "---\ndescription: no name\n---\n" : name === "utilities-weather" ? "" : name === "utilities-speech" ? body.replace(`name: ${name}`, "name: other") : body)
      }
      rmSync(join(root, "utilities-sessions"), { recursive: true, force: true })
      const { skills, problems } = await loadSkills(root)
      expect(skills.map(skill => skill.id)).toEqual(["utilities"])
      expect(problems).toHaveLength(4)
      for (const problem of problems) expect(problem).toMatch(/^The utilities-(?:time|weather|speech|sessions) skill was not loaded: .* Next step: /)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
