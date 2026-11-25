import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { loadSkills, parseSkill } from "../../src/skills.js"

/** The skill directories the package ships, read at test time so a new one is never missed. */
const shipped = readdirSync(join(process.cwd(), "skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

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
  test("every shipped skill directory parses, and the loader misses none of them", async () => {
    expect(shipped.length).toBeGreaterThan(0)
    const { skills, problems } = await loadSkills(join(process.cwd(), "skills"))
    expect(problems).toEqual([])
    expect(skills.map(skill => skill.id).sort()).toEqual(shipped)
  })
  test("an empty body is skipped and recorded, with SKILLS_INVALID", async () => {
    const root = mkdtempSync(join(tmpdir(), "utilities-skills-empty-"))
    try {
      const name = "utilities-empty"
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: A synthetic skill with no body.\n---\n\n   \n`)
      const { skills, problems } = await loadSkills(root)
      expect(skills).toEqual([])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/^SKILLS_INVALID: The utilities-empty skill was not loaded: skills\/utilities-empty\/SKILL\.md has an empty body\. Next step: /)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test.each([[""], [">\n  A folded line.\n"], ["|\n  A literal line.\n"], [">-\n  A chomped folded line.\n"]])("a description of %j is skipped, never registered as a marker", async description => {
    const root = mkdtempSync(join(tmpdir(), "utilities-skills-description-"))
    try {
      const name = "utilities-description"
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}${description.endsWith("\n") ? "" : "\n"}---\nBody.\n`)
      const { skills, problems } = await loadSkills(root)
      expect(skills).toEqual([])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(description === "" ? /has no description/ : /has a YAML block scalar description, which this loader does not fold/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test("a missing, malformed or misnamed file is skipped and recorded, never thrown", async () => {
    const root = mkdtempSync(join(tmpdir(), "utilities-skills-unit-"))
    try {
      for (const name of shipped) {
        const directory = join(root, name); mkdirSync(directory, { recursive: true })
        const body = `---\nname: ${name}\ndescription: A synthetic ${name} skill.\n---\nBody.\n`
        writeFileSync(join(directory, "SKILL.md"), name === "utilities-time" ? "---\ndescription: no name\n---\n" : name === "utilities-weather" ? "" : name === "utilities-speech" ? body.replace(`name: ${name}`, "name: other") : body)
      }
      rmSync(join(root, "utilities-sessions"), { recursive: true, force: true })
      const { skills, problems } = await loadSkills(root)
      expect(skills.map(skill => skill.id)).toEqual(["utilities"])
      expect(problems).toHaveLength(3)
      for (const problem of problems) expect(problem).toMatch(/^SKILLS_INVALID: The utilities-(?:time|weather|speech) skill was not loaded: .* Next step: /)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test("a missing skills folder is one problem, never a failed setup", async () => {
    const root = mkdtempSync(join(tmpdir(), "utilities-skills-absent-"))
    try {
      const { skills, problems } = await loadSkills(join(root, "skills"))
      expect(skills).toEqual([])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/^SKILLS_INVALID: The skills folder was not read: it is missing\. Next step: /)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
