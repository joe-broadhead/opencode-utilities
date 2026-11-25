// A skill with an empty body is skipped on the real embedded OpenCode 2.4.1 host: the plugin still loads, the other
// skills register, and status reports the problem. The host runs in a fresh process, so no skill registered by another
// test's host can leak into this answer.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { cleanup, packageCopy, skillsOf, SKILLS, root } from "../support/skills-host.js"

afterAll(cleanup)

describe("an empty-body skill on the real host", () => {
  test("is skipped, the others register, and status records the problem", () => {
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
})
