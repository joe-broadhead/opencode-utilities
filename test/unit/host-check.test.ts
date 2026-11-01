import { describe, expect, test } from "vitest"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../../src/domain/config.js"
import { checkHost, HOST_RANGE, tested } from "../../src/host/compat.js"

describe("host check", () => {
  test("the tested line is 2.2.3 up to, not including, 2.3.0", () => {
    expect(HOST_RANGE).toBe(">=2.2.3 <2.3.0")
    for (const version of ["2.2.3", "2.2.4", "2.2.10"]) expect(tested(version), version).toBe(true)
    for (const version of ["2.2.2", "2.3.0", "3.0.0", "2.2.4-beta.1", "0.0.0-dev-377", "unknown", "", "v2.2.3"]) expect(tested(version), version).toBe(false)
  })
  test("an untested host is refused with the next step", () => {
    expect(() => checkHost("2.3.0", false)).toThrow("HOST_UNTESTED: Utilities is tested on OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode 2.2.3 or a later 2.2.x release, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(() => checkHost("unknown", false)).toThrow("found unknown")
  })
  test("allowUntestedHost runs an untested host and keeps a warning for the status", () => {
    expect(checkHost("2.3.0", true)).toEqual({ required: HOST_RANGE, found: "2.3.0", availability: "HOST_UNTESTED", next: expect.stringContaining("untested") })
    expect(checkHost("2.2.4", false)).toEqual({ required: HOST_RANGE, found: "2.2.4", availability: "AVAILABLE" })
  })
})

describe("plugin options", () => {
  const env = { XDG_DATA_HOME: "/xdg/data", XDG_CACHE_HOME: "/xdg/cache" }
  test("defaults: every module on, XDG data and cache roots", () => {
    expect(loadConfig(undefined, env)).toEqual({ modules: { weather: true, time: true, speech: true }, stateRoot: "/xdg/data/opencode-utilities", cacheRoot: "/xdg/cache/opencode-utilities", allowUntestedHost: false })
    expect(loadConfig({}, { XDG_DATA_HOME: "relative/data" })).toMatchObject({ stateRoot: join(homedir(), ".local/share/opencode-utilities"), cacheRoot: join(homedir(), ".cache/opencode-utilities") })
  })
  test("each option is applied", () => {
    expect(loadConfig({ modules: { speech: false }, stateRoot: "/state", speech: { assetsDir: "/assets" }, allowUntestedHost: true }, env))
      .toEqual({ modules: { weather: true, time: true, speech: false }, stateRoot: "/state", cacheRoot: "/xdg/cache/opencode-utilities", speechAssetsDir: "/assets", allowUntestedHost: true })
  })
  test("every invalid key is named, and no value is echoed", () => {
    let message = ""
    try { loadConfig({ modules: { weather: "secret-value" }, stateRoot: "relative/secret", speech: { assetsDir: 7 }, policy: { x: "allow" }, allowActions: ["utilities_*"] }, env) } catch (error) { message = (error as Error).message }
    expect(message).toMatch(/^OPTIONS_INVALID: The plugin options are invalid: .*\. Next step: Fix /)
    for (const key of ["options.modules.weather", "options.stateRoot must be an absolute path", "options.speech.assetsDir", "options.policy is not a Utilities option", "options.allowActions is not a Utilities option"]) expect(message).toContain(key)
    expect(message).not.toContain("secret")
    expect(message).toContain("Configure in the README")
  })
})
