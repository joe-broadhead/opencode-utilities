import { afterEach, describe, expect, test, vi } from "vitest"
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createRuntime } from "../../src/runtime.js"
import { verifier } from "../../src/domain/backends.js"
import { LIMITS } from "../../src/domain/common.js"
import { WEATHER_ATTRIBUTION, type Authorize, type Runtime, type RuntimeOptions } from "../../src/domain/contract.js"
import { invoke as timeInvoke } from "../../src/modules/time/adapter.js"
import { calendar, fixture, invocation, MODELS, place, PACKAGE, VERSION, type Fixture, type FixtureOptions } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  try { for (const close of cleanups.splice(0).reverse()) await close() }
  finally { vi.useRealTimers(); vi.restoreAllMocks() }
})
async function setup(o: FixtureOptions & { runtime?: Partial<RuntimeOptions> } = {}) {
  const f = await fixture(o); cleanups.push(f.cleanup)
  const authorize = vi.fn<Authorize>(async () => {})
  const runtime = await createRuntime(f.options({ authorize, ...o.runtime })); cleanups.push(() => runtime.close())
  return { ...f, authorize, runtime }
}
async function another(f: Fixture, options: Partial<RuntimeOptions> = {}) {
  const runtime = await createRuntime(f.options(options)); cleanups.push(() => runtime.close()); return runtime
}
const requests = (authorize: ReturnType<typeof vi.fn<Authorize>>) => authorize.mock.calls.map(call => call[0])

describe("execution", () => {
  test("an approved computation runs one fixed program with a scrubbed environment and asks nothing", async () => {
    const f = await setup(); vi.stubEnv("PRIVATE_SECRET", "must-not-escape"); vi.stubEnv("HTTPS_PROXY", "https://private.example")
    const result = await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())
    expect(result).toEqual({ output: calendar, text: JSON.stringify(calendar) })
    const calls = await f.recorded()
    expect(calls).toHaveLength(1); expect(calls[0]!.env.PRIVATE_SECRET).toBeUndefined(); expect(calls[0]!.env.HTTPS_PROXY).toBeUndefined(); expect(calls[0]!.env.PATH).toBe("")
    expect(calls[0]!.argv.slice(-2)).toEqual(["--", "2026-10-29"]); expect(calls[0]!.files).toEqual(["empty.toml"])
    expect(f.authorize).not.toHaveBeenCalled()
    expect(await readdir(join(f.state, "jobs"))).toEqual([])
    vi.unstubAllEnvs()
  })
  test("input is parsed once, and INPUT_INVALID names fields and rules but never values", async () => {
    const f = await setup()
    const error = await f.runtime.invoke("time_calendar", { date: "private-2026-99-99", store: "/private/other" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "INPUT_INVALID" }); expect(error.message).toContain("date"); expect(error.message).not.toContain("private")
    expect(error.hint).toBeTruthy(); expect(await f.recorded()).toEqual([])
  })
  test("permission denial propagates the host's own error, and creates no state", async () => {
    const denied = { _tag: "Tool.Error", reason: "Denied" }, f = await setup()
    f.authorize.mockImplementation(async () => { throw denied })
    await expect(f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toBe(denied)
    expect(await f.recorded()).toEqual([]); expect(await readdir(f.state)).toEqual([])
  })
  test("cancellation while the permission prompt waits fences the call after a late approval", async () => {
    let approve!: () => void
    const f = await setup(), controller = new AbortController()
    f.authorize.mockImplementation(() => new Promise<void>(r => { approve = r }))
    const work = f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation(controller.signal))
    await vi.waitFor(() => expect(f.authorize).toHaveBeenCalled())
    expect(f.authorize.mock.calls[0]![1].signal.aborted).toBe(false)
    controller.abort(); approve()
    await expect(work).rejects.toMatchObject({ code: "CANCELLED" })
    expect(await f.recorded()).toEqual([])
  })
  test("unload cancels running work and refuses later calls", async () => {
    const f = await setup({ body: "record({}); setInterval(() => {}, 1000)" })
    const work = f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation()), rejection = expect(work).rejects.toMatchObject({ code: "CANCELLED" })
    await vi.waitFor(async () => expect(await f.recorded()).toHaveLength(1), { timeout: 15000 })
    await f.runtime.close(); await rejection
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "CLOSED" })
  })
  test("a disabled module never runs, and the others keep working", async () => {
    const f = await setup({ runtime: { modules: { weather: true, time: true, speech: false } } })
    await expect(f.runtime.invoke("speech_cleanup", { text: "private" }, invocation())).rejects.toMatchObject({ code: "DISABLED" })
    expect((await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).output).toEqual(calendar)
    expect((await f.recorded()).map(c => c.program)).toEqual(["time-keep"])
  })
})

describe("deadline", () => {
  test("the deadline starts after the permission prompt and queue admission", async () => {
    const f = await setup()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    // The person takes three deadlines to answer; nothing may expire while they decide.
    f.authorize.mockImplementation(async () => { await vi.advanceTimersByTimeAsync(LIMITS.deadline.time * 3) })
    const result = await f.runtime.invoke("timer_set", { name: "slow-approval", deadline: "2027-01-01T00:00:00Z" }, invocation())
    expect(result.output).toMatchObject({ name: "slow-approval" })
  })
  test("running past the deadline is DEADLINE_EXCEEDED, not CANCELLED", async () => {
    const f = await setup({ body: "record({}); setInterval(() => {}, 1000)" })
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const work = f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation()).catch(e => e)
    while (!(await f.recorded()).length) await new Promise(r => setImmediate(r))
    vi.advanceTimersByTime(LIMITS.deadline.time)
    const error = await work
    expect(error.code).toBe("DEADLINE_EXCEEDED"); expect(error.hint).toBeTruthy()
  })
})

describe("platform package and integrity", () => {
  test("a missing platform package is PLATFORM_PACKAGE_MISSING before any prompt, and status names the package", async () => {
    const f = await setup(); await rm(f.pkg, { recursive: true })
    await expect(f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toMatchObject({ code: "PLATFORM_PACKAGE_MISSING" })
    expect(f.authorize).not.toHaveBeenCalled()
    const status = await f.runtime.status()
    expect(status.platform).toEqual({ target: "darwin-arm64", package: PACKAGE, availability: "PLATFORM_PACKAGE_MISSING", next: `Reinstall the plugin so npm installs ${PACKAGE}@${VERSION}, then restart OpenCode.` })
    expect(status.modules.time.availability).toBe("PLATFORM_PACKAGE_MISSING"); expect(status.modules.speech.availability).toBe("AVAILABLE")
  })
  test("an unsupported platform is reported, never resolved to another package", async () => {
    const f = await setup({ runtime: { target: "win32-x64" } })
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" })
    const status = await f.runtime.status()
    expect(status.platform).toMatchObject({ target: "win32-x64", availability: "UNSUPPORTED_PLATFORM" }); expect(status.platform.package).toBeUndefined()
    expect(status.modules.speech.availability).toBe("UNSUPPORTED_PLATFORM")
  })
  test("missing, tampered, linked and non-executable binaries never run", async () => {
    const f = await setup(), bin = join(f.pkg, "bin/time-keep"), original = await readFile(bin, "utf8")
    await rm(bin)
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "BINARY_MISSING" })
    await writeFile(bin, original + "\n// tampered", { mode: 0o755 })
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" })
    await rm(bin); await writeFile(join(f.root, "real"), original, { mode: 0o755 }); await symlink(join(f.root, "real"), bin)
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "UNSAFE_PATH" })
    await rm(bin); await writeFile(bin, original, { mode: 0o644 })
    await expect(f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" })
    expect(await f.recorded()).toEqual([])
  })
  test("a binary changed while the prompt waits is re-verified and never runs", async () => {
    const f = await setup()
    f.authorize.mockImplementation(async () => { await writeFile(join(f.pkg, "bin/time-keep"), "#!/bin/sh\necho tampered", { mode: 0o755 }) })
    await expect(f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" })
    expect(await f.recorded()).toEqual([])
  })
  test("integrity is hashed once per process and file identity; status and calls reuse it", async () => {
    const f = await setup(), digest = vi.spyOn(verifier, "digest"), bin = join(f.pkg, "bin/time-keep")
    await f.runtime.status()
    await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())
    await (await another(f)).invoke("time_calendar", { date: "2026-10-29" }, invocation())
    expect(digest.mock.calls.filter(([path]) => path === bin)).toHaveLength(1)
    await utimes(bin, new Date(), new Date(Date.now() + 5000))
    await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())
    expect(digest.mock.calls.filter(([path]) => path === bin)).toHaveLength(2)
  })
})

describe("state root", () => {
  test.each([0o777, 0o755, 0o750, 0o500])("a state root with mode %s is refused after approval, before any state", async mode => {
    const f = await setup(); await chmod(f.state, mode)
    try {
      await expect(f.runtime.invoke("timer_set", { name: "private", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toMatchObject({ code: "STATE_NOT_PRIVATE" })
      expect(await readdir(f.state)).toEqual([]); expect(await f.recorded()).toEqual([]); expect(f.authorize).toHaveBeenCalledTimes(1)
    } finally { await chmod(f.state, 0o700) }
  })
  test("the state root is created only after approval, private, and permissions above it are irrelevant", async () => {
    const f = await setup(); await rm(f.state, { recursive: true }); await chmod(f.root, 0o755)
    const denied = new Error("DENIED"); f.authorize.mockRejectedValueOnce(denied)
    await expect(f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toBe(denied)
    await expect(lstat(f.state)).rejects.toMatchObject({ code: "ENOENT" })
    await f.runtime.invoke("timer_list", {}, invocation())
    expect((await lstat(f.state)).mode & 0o777).toBe(0o700)
  })
  test("a symbolic-link state root cannot create state in its target", async () => {
    const f = await setup(), target = join(f.root, "foreign")
    await mkdir(target, { mode: 0o700 }); await rm(f.state, { recursive: true }); await symlink(target, f.state)
    await expect(f.runtime.invoke("timer_list", {}, invocation())).rejects.toMatchObject({ code: "UNSAFE_PATH" })
    expect(await readdir(target)).toEqual([])
  })
  test("the state root must be owned by this user, independently of its mode", async () => {
    const f = await setup(), uid = process.getuid!()
    vi.spyOn(process, "getuid").mockReturnValue(uid + 1)
    await expect(f.runtime.invoke("timer_list", {}, invocation())).rejects.toMatchObject({ code: "STATE_NOT_PRIVATE" })
    expect(await readdir(f.state)).toEqual([])
  })
  test("setup removes crashed job directories and week-old default synthesis files, and keeps the rest", async () => {
    const f = await fixture(); cleanups.push(f.cleanup)
    const old = new Date(Date.now() - 8 * 24 * 3600000), jobs = join(f.state, "jobs"), scope = join(f.state, "speech", "a".repeat(64))
    await mkdir(join(jobs, "job-crashed"), { recursive: true, mode: 0o700 }); await writeFile(join(jobs, "job-crashed", "input.wav"), "private audio"); await utimes(join(jobs, "job-crashed"), old, old)
    await mkdir(join(jobs, "job-active"), { mode: 0o700 })
    await mkdir(scope, { recursive: true, mode: 0o700 })
    const stale = join(scope, "00000000-0000-4000-8000-000000000000.wav"), fresh = join(scope, "00000000-0000-4000-8000-000000000001.wav"), foreign = join(scope, "keep.wav")
    for (const file of [stale, fresh, foreign]) await writeFile(file, "wav")
    await utimes(stale, old, old); await utimes(foreign, old, old)
    await another(f)
    expect(await readdir(jobs)).toEqual(["job-active"])
    expect((await readdir(scope)).sort()).toEqual(["00000000-0000-4000-8000-000000000001.wav", "keep.wav"])
  })
})

describe("links above the plugin's directories", () => {
  // A link above a root is the user's setup, not the plugin's: macOS /tmp -> private/tmp, Fedora Atomic
  // /home -> var/home, or a dotfile link to ~/.local or ~/.cache. Links inside the plugin's folders stay refused.
  async function layout(f: Fixture, links: Record<string, string>) {
    for (const [link, target] of Object.entries(links)) { await mkdir(join(f.root, target), { recursive: true }); await symlink(target, join(f.root, link)) }
  }
  const works = async (runtime: Runtime) => {
    await expect(runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation())).resolves.toMatchObject({ output: calendar })
    await expect(runtime.invoke("timer_set", { name: "linked", deadline: "2027-01-01T00:00:00Z" }, invocation())).resolves.toMatchObject({ output: { name: "linked" } })
    await expect(runtime.invoke("timer_get", { name: "linked" }, invocation())).resolves.toMatchObject({ output: { name: "linked" } })
  }
  test("a linked install, state and cache path work, and status shows the resolved paths", async () => {
    const f = await fixture(); cleanups.push(f.cleanup)
    await symlink(".", join(f.root, "link"))
    const linked = join(f.root, "link"), runtime = await another(f, { packageRoot: linked, stateRoot: join(linked, "state"), cacheRoot: join(linked, "cache") })
    const status = await runtime.status()
    expect(status.modules).toEqual({ time: { availability: "AVAILABLE" }, weather: { availability: "AVAILABLE" }, speech: { availability: "AVAILABLE" } })
    expect(status.speech.assets.every(a => a.state === "cached")).toBe(true)
    expect(status.speech.cacheDirectory).toBe(f.cache); expect(status.timers.directory.startsWith(join(f.state, "projects"))).toBe(true)
    await works(runtime)
  })
  test("Fedora Atomic: /home -> var/home above XDG_DATA_HOME and XDG_CACHE_HOME, with the roots not created yet", async () => {
    const f = await fixture({ speech: "missing" }); cleanups.push(f.cleanup)
    // A user folder "u" under each home; joined from parts, so the forbidden-path scan sees no home path literal.
    const user = (...parts: string[]) => join(f.root, ...parts, "u")
    await layout(f, { home: join("var", "home") }); await mkdir(user("var", "home"), { mode: 0o700 })
    const runtime = await another(f, { stateRoot: join(user("home"), ".local/share/opencode-utilities"), cacheRoot: join(user("home"), ".cache/opencode-utilities") })
    const status = await runtime.status()
    expect(status.modules.time).toEqual({ availability: "AVAILABLE" }); expect(status.modules.speech.availability).toBe("SPEECH_ASSETS_MISSING")
    expect(status.speech.cacheDirectory).toBe(join(user("var", "home"), ".cache/opencode-utilities"))
    await works(runtime)
    expect((await lstat(join(user("var", "home"), ".local/share/opencode-utilities"))).mode & 0o777).toBe(0o700)
  })
  test("macOS: /tmp -> private/tmp above stateRoot and speech.assetsDir", async () => {
    const f = await fixture({ speech: "preseed" }); cleanups.push(f.cleanup)
    await layout(f, { tmp: "private/tmp" }); await rename(f.seed, join(f.root, "private/tmp/seed"))
    const runtime = await another(f, { stateRoot: join(f.root, "tmp/utilities-state"), speechAssetsDir: join(f.root, "tmp/seed") })
    const status = await runtime.status()
    expect(status.modules.speech).toEqual({ availability: "AVAILABLE" }); expect(status.speech.assets.every(a => a.state === "pre-seeded")).toBe(true)
    await works(runtime)
  })
  test.skipIf(process.platform !== "darwin")("macOS: the real /tmp, which is a link to /private/tmp", async () => {
    const f = await fixture(), state = await mkdtemp("/tmp/utilities-linked-"); cleanups.push(f.cleanup, () => rm(state, { recursive: true, force: true }))
    expect(await realpath(state)).toBe(join("/private", state))
    const runtime = await another(f, { stateRoot: join(state, "state") })
    await works(runtime)
    expect((await runtime.status()).timers.directory.startsWith(join("/private", state, "state", "projects"))).toBe(true)
  })
  test("a link inside the plugin's folders is UNSAFE_PATH, never an integrity failure", async () => {
    const f = await setup(), engine = f.cached("engine")
    await rename(engine, join(f.root, "engine")); await symlink(join(f.root, "engine"), engine)
    const status = await f.runtime.status()
    expect(status.modules.speech).toMatchObject({ availability: "UNSAFE_PATH" }); expect(status.modules.time).toEqual({ availability: "AVAILABLE" })
    await expect(f.runtime.invoke("speech_transcribe", { path: "clip.wav" }, invocation())).rejects.toMatchObject({ code: "UNSAFE_PATH" })
    const seed = await fixture({ speech: "preseed" }); cleanups.push(seed.cleanup)
    await rename(join(seed.seed, MODELS["tiny-q5_1"]), join(seed.root, "model")); await symlink(join(seed.root, "model"), join(seed.seed, MODELS["tiny-q5_1"]))
    expect((await (await another(seed)).status()).modules.speech).toMatchObject({ availability: "UNSAFE_PATH" })
  })
})

describe("timers", () => {
  test("writes ask for timer:<name> saved as timer:*, and reads ask nothing", async () => {
    const f = await setup()
    await f.runtime.invoke("timer_set", { name: "review", deadline: "2027-01-01T00:00:00Z" }, invocation())
    await f.runtime.invoke("timer_get", { name: "review" }, invocation())
    await f.runtime.invoke("timer_list", {}, invocation())
    await f.runtime.invoke("timer_check", {}, invocation())
    await f.runtime.invoke("timer_delete", { name: "review" }, invocation())
    expect(requests(f.authorize)).toEqual([
      [{ action: "utilities_timer_set", resources: ["timer:review"], save: ["timer:*"] }],
      [{ action: "utilities_timer_delete", resources: ["timer:review"], save: ["timer:*"] }],
    ])
    expect(f.authorize.mock.calls[0]![1]).toMatchObject({ sessionID: "session-original", agent: "agent-original", messageID: "message-original", id: "call-original" })
  })
  test("replace: false serializes concurrent runtimes and never upserts twice", async () => {
    const f = await setup(), second = await another(f)
    const input = { name: "duplicate", deadline: "2027-01-01T00:00:00Z" }
    const results = await Promise.allSettled([f.runtime.invoke("timer_set", input, invocation()), second.invoke("timer_set", input, invocation())])
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    const rejected = (results.find(r => r.status === "rejected") as PromiseRejectedResult).reason
    expect(rejected).toMatchObject({ code: "TIMER_EXISTS", message: "A timer named 'duplicate' already exists in this project.", hint: "Ask the user whether to overwrite it, then call utilities_timer_set with replace: true, or choose another name." })
    expect((await second.invoke("timer_list", {}, invocation())).output).toMatchObject({ count: 1 })
    await second.invoke("timer_set", { ...input, replace: true }, invocation())
    expect((await f.recorded()).filter(c => c.argv.includes("set"))).toHaveLength(2)
  })
  test("a missing timer is TIMER_NOT_FOUND for get and delete (time-keep exit 1, INVALID_PARAMS)", async () => {
    const f = await setup()
    await expect(f.runtime.invoke("timer_get", { name: "absent" }, invocation())).rejects.toMatchObject({ code: "TIMER_NOT_FOUND", message: "No timer named 'absent' exists in this project.", hint: "Call utilities_timer_list to see this project's timers." })
    await expect(f.runtime.invoke("timer_delete", { name: "absent" }, invocation())).rejects.toMatchObject({ code: "TIMER_NOT_FOUND" })
  })
  test("the timer scope derives from the host project and location, never from input", async () => {
    const f = await setup(), other = await another(f, { location: { project: "project-b", directory: f.project, projectDirectory: f.project } })
    await f.runtime.invoke("timer_set", { name: "private", deadline: "2027-01-01T00:00:00Z" }, invocation())
    expect((await other.invoke("timer_list", {}, invocation())).output).toEqual({ count: 0, total: 0, nextOffset: null, timers: [] })
    await expect(f.runtime.invoke("timer_list", { store: "/other" }, invocation())).rejects.toMatchObject({ code: "INPUT_INVALID" })
  })
  test("the quota is checked before the upstream write, and replacing stays possible", async () => {
    const f = await setup(); await f.runtime.invoke("timer_set", { name: "seed", deadline: "2027-01-01T00:00:00Z" }, invocation())
    const projects = await readdir(join(f.state, "projects")), db = join(f.state, "projects", projects[0]!, "timers/synthetic-timers.json")
    const [seed] = JSON.parse(await readFile(db, "utf8")); await writeFile(db, JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ ...seed, name: `timer-${i}` }))))
    await expect(f.runtime.invoke("timer_set", { name: "extra", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toMatchObject({ code: "TIMER_QUOTA" })
    await f.runtime.invoke("timer_set", { name: "timer-0", deadline: "2027-01-01T00:00:00Z", replace: true }, invocation())
    expect(JSON.parse(await readFile(db, "utf8"))).toHaveLength(1000)
  })
  test("an uncertain timer write is TIMER_STATE_UNKNOWN, never a safely retryable failure", async () => {
    const f = await setup({ body: `record({}); if (argv.includes('list')) out({ count: 0, timers: [] }); else process.stdout.write('malformed after effect')` })
    await expect(f.runtime.invoke("timer_set", { name: "x", deadline: "2027-01-01T00:00:00Z" }, invocation())).rejects.toMatchObject({ code: "TIMER_STATE_UNKNOWN", hint: "Call utilities_timer_get or utilities_timer_list before you retry." })
  })
  test("status counts due timers without creating a store", async () => {
    const f = await setup(), timers = (await f.runtime.status()).timers
    expect(timers).toEqual({ directory: expect.stringMatching(new RegExp(`^${join(f.state, "projects")}/[a-f0-9]{64}/timers$`)), due: 0 })
    expect(await readdir(f.state)).toEqual([])
    await f.runtime.invoke("timer_set", { name: "overdue", deadline: "2020-01-01T00:00:00Z" }, invocation())
    expect((await f.runtime.status()).timers).toMatchObject({ due: 1, next: "Call utilities_timer_check to see the due timers." })
  })
})

describe("timer store files", () => {
  const sqlite = ["timers.db", "timers.db-wal", "timers.db-shm", "timers.db-journal"]
  async function store() {
    const f = await fixture(); cleanups.push(f.cleanup)
    const path = join(f.root, "store"); await mkdir(path, { mode: 0o700 })
    return { f, path }
  }
  const context = (storePath: string, stage: string, run: (args: readonly string[]) => Promise<unknown>) => ({ store: storePath, stage, signal: new AbortController().signal, run })
  test.each(sqlite)("a hardlinked %s planted by another actor is never read or changed", async file => {
    const { f, path } = await store(), foreign = join(f.root, "foreign.db")
    const row = { name: "foreign-owner", deadline: "2027-01-01T00:00:00Z", description: "synthetic foreign state" }
    await writeFile(foreign, JSON.stringify(row)); await link(foreign, join(path, file))
    // Deliberately functional double: a missed preflight reads or overwrites the aliased file.
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.includes("set")) { await writeFile(join(path, file), JSON.stringify({ ...row, deadline: "2028-01-01T00:00:00Z" })); return {} }
      return { count: 0, timers: [], foreign: JSON.parse(await readFile(join(path, file), "utf8")) }
    })
    await expect(timeInvoke("timer_list", { offset: 0, limit: 20 }, context(path, f.root, run))).rejects.toMatchObject({ code: "STATE_FILE_UNSAFE" })
    await expect(timeInvoke("timer_set", { name: row.name, deadline: "2028-01-01T00:00:00Z", tags: [], replace: true }, context(path, f.root, run))).rejects.toMatchObject({ code: "STATE_FILE_UNSAFE" })
    expect(JSON.parse(await readFile(foreign, "utf8"))).toEqual(row); expect(run).not.toHaveBeenCalled()
    expect(await readdir(path)).toEqual([file])
  })
  test.each(sqlite)("a non-regular %s is refused before any read or write", async file => {
    const { f, path } = await store(); await mkdir(join(path, file), { recursive: true, mode: 0o700 })
    const run = vi.fn(async () => ({ count: 0, timers: [] }))
    await expect(timeInvoke("timer_list", { offset: 0, limit: 20 }, context(path, f.root, run))).rejects.toMatchObject({ code: "STATE_FILE_UNSAFE" })
    await expect(timeInvoke("timer_delete", { name: "foreign" }, context(path, f.root, run))).rejects.toMatchObject({ code: "STATE_FILE_UNSAFE" })
    expect(run).not.toHaveBeenCalled()
  })
  test("SQLite files are checked again between the timer_set preflight and its write", async () => {
    const { f, path } = await store(), foreign = join(f.root, "foreign.db"); await writeFile(foreign, "foreign row unchanged")
    const run = vi.fn(async () => { await link(foreign, join(path, "timers.db")); return { count: 0, timers: [] } })
    await expect(timeInvoke("timer_set", { name: "new", deadline: "2027-01-01T00:00:00Z", tags: [], replace: false }, context(path, f.root, run))).rejects.toMatchObject({ code: "STATE_FILE_UNSAFE" })
    expect(run).toHaveBeenCalledTimes(1); expect(await readFile(foreign, "utf8")).toBe("foreign row unchanged")
  })
})

describe("weather", () => {
  test("weather-signal's cache outlives the call in a private folder under the cache root, and old entries are swept (UTIL-2)", async () => {
    // Plays weather-signal's cache: one file per request in $XDG_CACHE_HOME/weather-signal, read back if present.
    const body = `const dir = path.join(process.env.XDG_CACHE_HOME, 'weather-signal'), file = path.join(dir, '${"a".repeat(64)}.json')
      record({ hit: fs.existsSync(file) }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, '{}'); out([${JSON.stringify(place)}])`
    const f = await setup({ body }), cache = join(f.cache, "weather")
    await f.runtime.invoke("weather_geocode", { query: "Cape Town" }, invocation())
    await f.runtime.invoke("weather_geocode", { query: "Cape Town" }, invocation())
    const calls = await f.recorded() as unknown as { env: Record<string, string>; hit: boolean }[]
    expect(calls.map(c => [c.env.XDG_CACHE_HOME, c.hit])).toEqual([[cache, false], [cache, true]])
    expect((await lstat(join(cache, "weather-signal"))).mode & 0o777).toBe(0o700)
    const old = new Date(Date.now() - 32 * 24 * 3600000), stale = join(cache, "weather-signal", `${"b".repeat(64)}.json`)
    await writeFile(stale, "{}"); await utimes(stale, old, old)
    await another(f)
    expect(await readdir(join(cache, "weather-signal"))).toEqual([`${"a".repeat(64)}.json`])
  })
  test("every result carries the attribution, and the call asks for the provider hosts with the location", async () => {
    const f = await setup()
    const current = await f.runtime.invoke("weather_current", { location: "Cape Town", country: "ZA" }, invocation())
    expect(current.output).toMatchObject({ source: "open-meteo", units: { temperature_2m: "°C" }, attribution: WEATHER_ATTRIBUTION })
    expect(current.text.endsWith(`\n${WEATHER_ATTRIBUTION}.`)).toBe(true)
    const geocode = await f.runtime.invoke("weather_geocode", { query: "Cape Town" }, invocation())
    expect(geocode.output).toEqual({ locations: [place], attribution: WEATHER_ATTRIBUTION })
    expect(requests(f.authorize)).toEqual([
      [{ action: "utilities_weather_current", resources: ["api.open-meteo.com", "geocoding-api.open-meteo.com"], save: ["api.open-meteo.com", "geocoding-api.open-meteo.com"], metadata: { location: "Cape Town" } }],
      [{ action: "utilities_weather_geocode", resources: ["geocoding-api.open-meteo.com"], save: ["geocoding-api.open-meteo.com"], metadata: { location: "Cape Town" } }],
    ])
    const [call] = await f.recorded()
    expect(call!.argv).toContain("--forecast-base-url=https://api.open-meteo.com/v1/forecast"); expect(call!.env.OPEN_METEO_API_KEY).toBeUndefined()
  })
  test("a connected key goes to the child environment, never argv, and switches to the customer hosts", async () => {
    const f = await setup({ runtime: { weatherKey: async () => "secret-commercial-key" } })
    await f.runtime.invoke("weather_current", { location: "Cape Town" }, invocation())
    const [call] = await f.recorded()
    expect(call!.env.OPEN_METEO_API_KEY).toBe("secret-commercial-key"); expect(call!.argv.join(" ")).not.toContain("secret-commercial-key")
    expect(call!.argv).toEqual(expect.arrayContaining(["--forecast-base-url=https://customer-api.open-meteo.com/v1/forecast", "--geocode-base-url=https://customer-geocoding-api.open-meteo.com/v1/search", "--historical-base-url=https://customer-archive-api.open-meteo.com/v1/archive"]))
    expect(requests(f.authorize)[0]![0]!.resources).toEqual(["customer-api.open-meteo.com", "customer-geocoding-api.open-meteo.com"])
  })
  test("provider failures are mapped without echoing the location", async () => {
    const f = await setup({ runtime: { weatherKey: async () => "rejected-key" } })
    await expect(f.runtime.invoke("weather_current", { location: "Cape Town" }, invocation())).rejects.toMatchObject({ code: "WEATHER_KEY_REJECTED" })
    const g = await setup()
    const error = await g.runtime.invoke("weather_current", { location: "Nowhere" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "BACKEND_FAILED", message: "Open-Meteo found no place with that name." }); expect(error.message + error.hint).not.toContain("Nowhere")
  })
})

describe("status", () => {
  test("the runtime fills platform, modules, speech and timers", async () => {
    const f = await setup()
    const status = await f.runtime.status()
    expect(status.platform).toEqual({ target: "darwin-arm64", package: PACKAGE, availability: "AVAILABLE" })
    expect(status.modules).toEqual({ time: { availability: "AVAILABLE" }, weather: { availability: "AVAILABLE" }, speech: { availability: "AVAILABLE" } })
    expect(status.speech).toMatchObject({ voices: expect.arrayContaining(["Luna"]), cacheDirectory: f.cache, outputDirectory: expect.stringContaining(join(f.state, "speech")) })
    expect(status.speech.assets.map(a => [a.role, a.state])).toEqual([["engine", "cached"], ["tiny-q5_1", "cached"], ["kitten-model", "cached"], ["kitten-voices", "cached"], ["kitten-config", "cached"]])
    expect(Object.keys(status).sort()).toEqual(["modules", "platform", "speech", "timers"])
  })
  test("a disabled module says how to turn it on, and its files are not inspected", async () => {
    const f = await setup({ runtime: { modules: { weather: false, time: true, speech: false } } }), digest = vi.spyOn(verifier, "digest")
    const status = await f.runtime.status()
    expect(status.modules.weather).toEqual({ availability: "DISABLED", next: "Set modules.weather to true in the utilities.tools plugin options." })
    expect(status.modules.speech.availability).toBe("DISABLED"); expect(status.speech.assets).toEqual([])
    expect(digest.mock.calls.map(([path]) => path).filter(path => path.startsWith(f.cache))).toEqual([])
  })
})

describe("errors", () => {
  test("every failure carries a code, a message and, where there is one, a next step", async () => {
    const f = await setup(); await f.runtime.close()
    const error = await f.runtime.invoke("time_calendar", { date: "2026-10-29" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "CLOSED", message: "The Utilities plugin is shutting down.", hint: "Retry after OpenCode has reloaded the plugin." })
    const runtime: Runtime = await another(f, { modules: { weather: false, time: true, speech: true } })
    const disabled = await runtime.invoke("weather_current", { location: "x" }, invocation()).catch(e => e)
    expect(disabled).toMatchObject({ code: "DISABLED", message: "This module is turned off in the plugin options." }); expect(disabled.hint).toContain("modules.")
  })
})
