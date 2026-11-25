import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import type { Plugin } from "@opencode/plugin"
import { readSkills, registerSkills } from "../../src/skills.js"

/** The skill directories the package ships, read at test time so a new one is never missed. */
const shipped = readdirSync(join(process.cwd(), "skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== "node_modules")
  .map(entry => entry.name)
  .sort()

/** A temporary `skills/` directory holding one file per entry. */
function fixture(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "utilities-skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

describe("the skill loader", () => {
  test("checks every shipped skill, with its YAML description, name, path and body", () => {
    const skills = readSkills()
    expect(shipped.length).toBeGreaterThan(0)
    expect(skills.map(skill => skill.id)).toEqual(shipped)
    for (const skill of skills) {
      expect(skill.name).toBe(skill.id)
      expect(skill.description.length).toBeGreaterThan(0)
      expect(["", ">", "|", ">-", "|-", ">+", "|+"].includes(skill.description.trim()), skill.id).toBe(false)
      expect(skill.content.trim().length).toBeGreaterThan(0)
      expect(skill.path).toBe(join(process.cwd(), "skills", skill.id, "SKILL.md"))
    }
  })
  test("YAML block scalars are folded, literal or stripped as YAML specifies", () => {
    const cases: readonly [string, string, string][] = [
      ["folded", ">", "first line second line\n"],
      ["literal", "|", "first line\nsecond line\n"],
      ["folded-strip", ">-", "first line second line"],
      ["literal-strip", "|-", "first line\nsecond line"],
    ]
    for (const [name, marker, expected] of cases) {
      const directory = fixture({ [name]: `---\nname: ${name}\ndescription: ${marker}\n  first line\n  second line\n---\n\n# Body\n` })
      try {
        expect(readSkills(directory)[0]?.description, name).toBe(expected)
      } finally { rmSync(directory, { recursive: true, force: true }) }
    }
  })
  test("a marker-only or empty description is refused", () => {
    const marker = fixture({ marker: "---\nname: marker\ndescription: '>'\n---\n\n# Body\n" })
    try { expect(() => readSkills(marker)).toThrow(/only a block marker/) } finally { rmSync(marker, { recursive: true, force: true }) }
    const empty = fixture({ empty: "---\nname: empty\ndescription: >\n---\n\n# Body\n" })
    try { expect(() => readSkills(empty)).toThrow(/has no frontmatter description/) } finally { rmSync(empty, { recursive: true, force: true }) }
  })
  test("invalid YAML is a SCHEMA_VIOLATION, not a partial load", () => {
    const broken = fixture({ broken: "---\nname: broken\ndescription: [unclosed\n---\n\n# Body\n" })
    try { expect(() => readSkills(broken)).toThrow(/SCHEMA_VIOLATION: skills\/broken\/SKILL\.md has frontmatter that is not valid YAML/) } finally { rmSync(broken, { recursive: true, force: true }) }
  })
  test("a skill file must have the frontmatter shape the plugin registers", () => {
    const cases: readonly [string, Readonly<Record<string, string>>, RegExp][] = [
      ["no frontmatter", { broken: "# Broken\n" }, /SCHEMA_VIOLATION: skills\/broken\/SKILL\.md has no frontmatter\. Next step: /],
      ["no name", { broken: "---\ndescription: A description.\n---\n\n# Body\n" }, /has no frontmatter name/],
      ["another name", { broken: "---\nname: other\ndescription: A description.\n---\n\n# Body\n" }, /names "other", not its directory "broken"/],
      ["no description", { broken: "---\nname: broken\n---\n\n# Body\n" }, /has no frontmatter description/],
      ["empty content", { broken: "---\nname: broken\ndescription: A description.\n---\n\n" }, /has no content below its frontmatter/],
    ]
    for (const [name, files, expected] of cases) {
      const directory = fixture(files)
      try { expect(() => readSkills(directory), name).toThrow(expected) } finally { rmSync(directory, { recursive: true, force: true }) }
    }
    const missing = mkdtempSync(join(tmpdir(), "utilities-skills-"))
    try {
      mkdirSync(join(missing, "empty"), { recursive: true })
      expect(() => readSkills(missing)).toThrow(/skills\/empty\/SKILL\.md is missing/)
    } finally { rmSync(missing, { recursive: true, force: true }) }
    const none = mkdtempSync(join(tmpdir(), "utilities-skills-"))
    try { expect(() => readSkills(none)).toThrow(/skills\/ holds no <name>\/SKILL\.md/) } finally { rmSync(none, { recursive: true, force: true }) }
  })
  test("registerSkills adds every checked skill and returns a disposer", async () => {
    const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
    let disposed = false
    const context = {
      skill: {
        async transform(callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) {
          callback({ add: skill => added.push(skill) })
          return { async dispose() { disposed = true } }
        },
      },
    } as unknown as Plugin.Context
    const registration = await registerSkills(context)
    expect(added.map(skill => skill.id)).toEqual(shipped)
    expect(added.every(skill => (skill.description ?? "").length > 0 && skill.content.trim().length > 0)).toBe(true)
    await registration.dispose()
    expect(disposed).toBe(true)
  })
})
