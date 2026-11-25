// A folded-block description is read as its text, not as `>`, on the real embedded OpenCode 2.4.1 host. The host runs
// on an empty temporary project in a fresh process, so the answer comes from the plugin's registration alone.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, packageCopy, skillsOf, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("a block-scalar description on the real host", () => {
  test("registers the folded text, never the marker", () => {
    const id = "utilities-speech"
    const folded = "A folded description that a first-line reader would register as a marker."
    const packageRoot = packageCopy("folded-package")
    writeFileSync(join(packageRoot, "skills", id, "SKILL.md"), `---\nname: ${id}\ndescription: >\n  A folded description that a first-line reader would\n  register as a marker.\n---\n\n# Body\n`)
    const directory = join(root, "folded-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    const skill = skills.find(candidate => candidate.id === id)
    expect(skill).toBeDefined()
    expect(skill!.description).toBe(`${folded}\n`)
    expect(skill!.description).not.toBe(">")
  }, 120_000)
})
