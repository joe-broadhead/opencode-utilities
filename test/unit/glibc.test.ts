// The glibc floors (#1): the time and weather programs run on glibc 2.34 or later (Ubuntu 22.04, RHEL 9), the speech
// engine on 2.39 or later.
// A Linux below a floor reports UNSUPPORTED_PLATFORM for that module, with the floor, before any prompt or download,
// instead of failing when the binary starts. A Linux at or above it, and any other platform, behave as before.
import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createRuntime } from "../../src/runtime.js"
import { belowGlibcFloor, detectGlibc, olderGlibc } from "../../src/domain/backends.js"
import { GLIBC_FLOORS, type Authorize } from "../../src/domain/contract.js"
import { fixture, invocation, VERSION } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

/** The synthetic release, moved to linux-x64-gnu: both manifests name it, and the cached programs sit under it. */
async function linux(glibc: string | null) {
  const f = await fixture(); cleanups.push(f.cleanup)
  for (const name of ["native.json", "speech-assets.json"]) {
    const path = join(f.root, "manifest", name)
    await writeFile(path, (await readFile(path, "utf8")).replaceAll("darwin-arm64", "linux-x64-gnu"))
  }
  for (const module of ["time-keep", "weather-signal"] as const) {
    const to = join(f.cache, "native", `v${VERSION}`, module, "linux-x64-gnu", module)
    await mkdir(dirname(to), { recursive: true, mode: 0o700 }); await rename(f.binary(module), to)
  }
  // The engine's file name names its platform too, and the cache keeps a file under its name.
  await rename(f.cached("engine"), f.cached("engine").replace("darwin-arm64", "linux-x64-gnu"))
  const authorize = vi.fn<Authorize>(async () => {})
  const runtime = await createRuntime(f.options({ authorize, target: "linux-x64-gnu", glibc })); cleanups.push(() => runtime.close())
  return { ...f, authorize, runtime }
}

describe("the floors", () => {
  test("are 2.34 for the programs and 2.39 for the speech engine", () => {
    expect(GLIBC_FLOORS).toEqual({ "time-keep": "2.34", "weather-signal": "2.34", "utilities-speech": "2.39" })
  })
  test("compare by number, not as text", () => {
    expect(olderGlibc("2.9", "2.35")).toBe(true)
    expect(olderGlibc("2.35", "2.35")).toBe(false)
    expect(olderGlibc("2.39", "2.35")).toBe(false)
    expect(olderGlibc("2.38", "2.39")).toBe(true)
    expect(olderGlibc("3.0", "2.39")).toBe(false)
  })
  test("apply only to Linux, and only when the system's glibc is known", () => {
    expect(belowGlibcFloor("linux-x64-gnu", "2.35", "utilities-speech")).toBe("needs glibc 2.39 or later, and this system has glibc 2.35")
    expect(belowGlibcFloor("linux-arm64-gnu", "2.31", "time-keep")).toBe("needs glibc 2.34 or later, and this system has glibc 2.31")
    expect(belowGlibcFloor("linux-arm64-gnu", "2.33", "weather-signal")).toBe("needs glibc 2.34 or later, and this system has glibc 2.33")
    // RHEL 9 and its rebuilds ship glibc 2.34: the programs run there; Ubuntu 22.04's 2.35 runs them too.
    expect(belowGlibcFloor("linux-x64-gnu", "2.34", "time-keep")).toBeUndefined()
    expect(belowGlibcFloor("linux-x64-gnu", "2.35", "time-keep")).toBeUndefined()
    expect(belowGlibcFloor("linux-x64-gnu", null, "utilities-speech")).toBeUndefined()
    expect(belowGlibcFloor("darwin-arm64", "2.31", "utilities-speech")).toBeUndefined()
  })
  test("the process's own glibc is read on Linux, and is null elsewhere", () => {
    const glibc = detectGlibc()
    if (process.platform === "linux") expect(glibc === null || /^\d+\.\d+/.test(glibc)).toBe(true)
    else expect(glibc).toBeNull()
  })
})

describe("a Linux below the speech engine's floor", () => {
  test("reports speech UNSUPPORTED_PLATFORM with the floor, before any prompt or download, and time and weather still run", async () => {
    const f = await linux("2.35")
    await expect(f.runtime.invoke("speech_synthesize", { text: "x" }, invocation())).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM",
      message: "The speech engine needs glibc 2.39 or later, and this system has glibc 2.35.",
      hint: "Time and weather tools are unaffected. Speech needs a Linux such as Ubuntu 24.04, Debian 13 or Fedora 40.",
    })
    expect(f.authorize).not.toHaveBeenCalled()
    expect(await f.runtime.installSpeech().catch(e => e)).toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
    const status = await f.runtime.status()
    expect(status.modules.speech).toEqual({ availability: "UNSUPPORTED_PLATFORM", next: "The speech engine needs glibc 2.39 or later, and this system has glibc 2.35." })
    expect(status.platform).toEqual({ target: "linux-x64-gnu", availability: "AVAILABLE" })
    expect(status.modules.time.availability).toBe("AVAILABLE")
    expect((await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).output).toBeDefined()
  })
})

describe("RHEL 9 and its rebuilds (glibc 2.34)", () => {
  test("run time and weather, and report speech UNSUPPORTED_PLATFORM with its floor", async () => {
    const f = await linux("2.34")
    const status = await f.runtime.status()
    expect(status.platform).toEqual({ target: "linux-x64-gnu", availability: "AVAILABLE" })
    expect(status.modules.time.availability).toBe("AVAILABLE")
    expect(status.modules.weather.availability).toBe("AVAILABLE")
    expect(status.modules.speech).toEqual({ availability: "UNSUPPORTED_PLATFORM", next: "The speech engine needs glibc 2.39 or later, and this system has glibc 2.34." })
    expect((await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).output).toBeDefined()
  })
})

describe("a Linux below the programs' floor", () => {
  test("reports every module UNSUPPORTED_PLATFORM with its floor, and runs and downloads nothing", async () => {
    const f = await linux("2.31")
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM",
      message: "The time-keep program needs glibc 2.34 or later, and this system has glibc 2.31.",
    })
    expect(await f.recorded()).toEqual([])
    await expect(f.runtime.installNatives()).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
    const status = await f.runtime.status()
    expect(status.platform).toEqual({ target: "linux-x64-gnu", availability: "UNSUPPORTED_PLATFORM", next: "The time and weather programs need glibc 2.34 or later, and this system has glibc 2.31." })
    expect(status.modules.time).toEqual({ availability: "UNSUPPORTED_PLATFORM", next: "The time-keep program needs glibc 2.34 or later, and this system has glibc 2.31." })
    expect(status.modules.weather).toEqual({ availability: "UNSUPPORTED_PLATFORM", next: "The weather-signal program needs glibc 2.34 or later, and this system has glibc 2.31." })
    expect(status.modules.speech.availability).toBe("UNSUPPORTED_PLATFORM")
  })
})

describe("a Linux at the floors", () => {
  test("runs every module as before", async () => {
    const f = await linux("2.39")
    const status = await f.runtime.status()
    expect(status.platform.availability).toBe("AVAILABLE")
    expect(status.modules.time.availability).toBe("AVAILABLE")
    expect(status.modules.speech.availability).toBe("AVAILABLE")
    expect((await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation())).output).toMatchObject({ durationMs: 500 })
  })
})
