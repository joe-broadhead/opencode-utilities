import { describe, expect, test } from "vitest"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../../src/domain/config.js"
import { UtilitiesError } from "../../src/domain/common.js"
import { AVAILABILITY } from "../../src/domain/contract.js"
import { checkHost, HOST_RANGE, inRange, TESTED_HOSTS, tested } from "../../src/host/compat.js"

describe("host check", () => {
  test("the supported line is 2.2.3 up to, not including, 2.3.0; the tested releases are 2.2.3, 2.2.4 and 2.2.5", () => {
    expect(HOST_RANGE).toBe(">=2.2.3 <2.3.0")
    for (const version of ["2.2.3", "2.2.4", "2.2.5", "2.2.10"]) expect(inRange(version), version).toBe(true)
    for (const version of ["2.2.2", "2.3.0", "3.0.0", "2.2.4-beta.1", "0.0.0-dev-377", "unknown", "", "v2.2.3"]) expect(inRange(version), version).toBe(false)
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5"])
    expect(["2.2.3", "2.2.4", "2.2.5", "2.2.6"].map(tested)).toEqual([true, true, true, false])
  })
  test("a host outside the range is refused with the next step", () => {
    expect(() => checkHost("2.3.0", false)).toThrow("HOST_UNTESTED: Utilities supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode 2.2.3, 2.2.4 or 2.2.5, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(() => checkHost("unknown", false)).toThrow("found unknown")
    // The shared failure text is the one the refusal uses, and no module availability is ever HOST_UNTESTED (UTIL-R11).
    expect(new UtilitiesError("HOST_UNTESTED").hint).toBe("Use OpenCode 2.2.3, 2.2.4 or 2.2.5, or set the plugin option allowUntestedHost: true to run anyway.")
    expect(AVAILABILITY).not.toContain("HOST_UNTESTED")
  })
  test("a tested release runs; another release in the range runs untested; allowUntestedHost runs one outside it, with a warning", () => {
    expect(checkHost("2.2.5", false)).toEqual({ version: "2.2.5", range: HOST_RANGE, tested: true })
    expect(checkHost("2.2.6", false)).toEqual({ version: "2.2.6", range: HOST_RANGE, tested: false })
    expect(checkHost("2.3.0", true)).toEqual({ version: "2.3.0", range: HOST_RANGE, tested: false, next: expect.stringContaining("allowUntestedHost is set") })
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
