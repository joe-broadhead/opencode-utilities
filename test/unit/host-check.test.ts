import { describe, expect, test } from "vitest"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../../src/domain/config.js"
import { UtilitiesError } from "../../src/domain/common.js"
import { AVAILABILITY } from "../../src/domain/contract.js"
import { checkHost, HOST_RANGE, inRange, TESTED_HOSTS, tested } from "../../src/host/compat.js"

describe("host check", () => {
  test("the supported line is 2.4.1 up to, not including, 2.5.0; the tested release is 2.4.1", () => {
    expect(HOST_RANGE).toBe(">=2.4.1 <2.5.0")
    for (const version of ["2.4.1", "2.4.99"]) expect(inRange(version), version).toBe(true)
    for (const version of ["2.4.0", "2.5.0", "3.0.0", "2.4.1-beta.1", "0.0.0-dev-377", "unknown", "", "v2.4.1"]) expect(inRange(version), version).toBe(false)
    expect(TESTED_HOSTS).toEqual(["2.4.1"])
    expect(["2.4.1", "2.4.2"].map(tested)).toEqual([true, false])
  })
  test("a host outside the range is refused with the next step", () => {
    expect(() => checkHost("2.5.0", false)).toThrow("HOST_UNTESTED: Utilities supports OpenCode >=2.4.1 <2.5.0, found 2.5.0. Next step: Use OpenCode 2.4.1, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(() => checkHost("unknown", false)).toThrow("found unknown")
    // The shared failure text is the one the refusal uses, and no module availability is ever HOST_UNTESTED.
    expect(new UtilitiesError("HOST_UNTESTED").hint).toBe("Use OpenCode 2.4.1, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(AVAILABILITY).not.toContain("HOST_UNTESTED")
  })
  test("a tested release runs; another release in the range runs untested; allowUntestedHost runs one outside it, with a warning", () => {
    expect(checkHost("2.4.1", false)).toEqual({ version: "2.4.1", range: HOST_RANGE, tested: true })
    expect(checkHost("2.4.99", false)).toEqual({ version: "2.4.99", range: HOST_RANGE, tested: false })
    expect(checkHost("2.5.0", true)).toEqual({ version: "2.5.0", range: HOST_RANGE, tested: false, next: expect.stringContaining("allowUntestedHost is set") })
  })
})

describe("plugin options", () => {
  const env = { XDG_DATA_HOME: "/xdg/data", XDG_CACHE_HOME: "/xdg/cache" }
  test("defaults: every module on, XDG data and cache roots, and OpenCode's database under XDG data", () => {
    expect(loadConfig(undefined, env)).toEqual({ modules: { weather: true, time: true, speech: true }, stateRoot: "/xdg/data/opencode-utilities", cacheRoot: "/xdg/cache/opencode-utilities", sessionsDatabasePath: "/xdg/data/opencode/opencode.db", allowUntestedHost: false, access: "all" })
    expect(loadConfig({}, { XDG_DATA_HOME: "relative/data" })).toMatchObject({ stateRoot: join(homedir(), ".local/share/opencode-utilities"), cacheRoot: join(homedir(), ".cache/opencode-utilities"), sessionsDatabasePath: join(homedir(), ".local/share/opencode/opencode.db") })
  })
  test("each option is applied", () => {
    expect(loadConfig({ modules: { speech: false }, stateRoot: "/state", speech: { assetsDir: "/assets" }, sessionsDatabasePath: "/data/opencode.db", allowUntestedHost: true }, env))
      .toEqual({ modules: { weather: true, time: true, speech: false }, stateRoot: "/state", cacheRoot: "/xdg/cache/opencode-utilities", speechAssetsDir: "/assets", sessionsDatabasePath: "/data/opencode.db", allowUntestedHost: true, access: "all" })
    expect(loadConfig({ access: "read-only" }, env).access).toBe("read-only")
    expect(loadConfig({ access: "ask-changes" }, env).access).toBe("ask-changes")
  })
  test("every invalid key is named, and no value is echoed", () => {
    let message = ""
    try { loadConfig({ modules: { weather: "secret-value" }, stateRoot: "relative/secret", speech: { assetsDir: 7 }, sessionsDatabasePath: "relative/opencode.db", policy: { x: "allow" }, allowActions: ["utilities_*"] }, env) } catch (error) { message = (error as Error).message }
    expect(message).toMatch(/^OPTIONS_INVALID: The plugin options are invalid: .*\. Next step: Fix /)
    for (const key of ["options.modules.weather", "options.stateRoot must be an absolute path", "options.speech.assetsDir", "options.sessionsDatabasePath must be an absolute path", "options.policy is not a Utilities option", "options.allowActions is not a Utilities option"]) expect(message).toContain(key)
    expect(message).not.toContain("secret")
    expect(message).toContain("Configure in the README")
  })
})
