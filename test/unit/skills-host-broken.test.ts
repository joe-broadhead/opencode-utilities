// A skill with an empty body is skipped on the real embedded OpenCode 2.4.1 host: the plugin still loads, the other
// skills register, and status reports the problem. The host runs in a fresh process, so no skill registered by another
// test's host can leak into this answer.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, packageCopy, skillsOf, SKILLS, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("a broken skill on the real host", () => {
  test("an empty body is skipped, the others register, and status records the problem", () => {
    const broken = "utilities-time"
    expect(SKILLS).toContain(broken)
    const packageRoot = packageCopy("broken-package", broken)
    const directory = join(root, "broken-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills, status } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    const ids = skills.map(skill => skill.id)
    expect(ids).not.toContain(broken)
    for (const name of SKILLS.filter(skill => skill !== broken)) expect(ids).toContain(name)
    const answer = status as { state: string; nextStep: string | null }
    expect(answer.state).toBe("error")
    expect(String(answer.nextStep)).toContain(`SKILLS_INVALID: The ${broken} skill was not loaded`)
    expect(String(answer.nextStep)).toContain("has an empty body")
  }, 120_000)

  test("a folded-block description is skipped, never registered as a marker", () => {
    const folded = "utilities-speech"
    const packageRoot = packageCopy("folded-package")
    writeFileSync(join(packageRoot, "skills", folded, "SKILL.md"), `---\nname: ${folded}\ndescription: >\n  A folded description a first-line reader would register as a marker.\n---\nBody.\n`)
    const directory = join(root, "folded-project"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "opencode.json"), "{}")
    const { skills, status } = skillsOf(join(packageRoot, "dist/index.js"), directory)
    const speech = skills.find(skill => skill.id === folded)
    expect(speech).toBeUndefined()
    expect(skills.some(skill => skill.description === ">" || skill.description === "|")).toBe(false)
    for (const name of SKILLS.filter(skill => skill !== folded)) expect(skills.map(skill => skill.id)).toContain(name)
    const answer = status as { state: string; nextStep: string | null }
    expect(answer.state).toBe("error")
    expect(String(answer.nextStep)).toContain(`SKILLS_INVALID: The ${folded} skill was not loaded`)
    expect(String(answer.nextStep)).toContain("YAML block scalar")
  }, 120_000)
})
