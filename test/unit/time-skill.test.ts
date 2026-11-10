// The time skill's description decides whether the model loads it. A reminder for a day of the week must reach the
// memory skill, so the description carries no day-name trigger.
import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const skill = readFileSync(fileURLToPath(new URL("../../skills/utilities-time/SKILL.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n")
const description = skill.split("\n").find((line) => line.startsWith("description:")) ?? ""

describe("the utilities-time skill description", () => {
  test("names no day-of-the-week trigger, so a reminder for a day does not load the time skill", () => {
    expect(description).not.toContain("after Friday")
    expect(description).toContain('"the next business day after a given date"')
  })
})
