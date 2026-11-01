import { afterEach, describe, expect, test, vi } from "vitest"
import { lstat, mkdir, readdir, readFile, rm, rmdir, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createRuntime } from "../../src/runtime.js"
import type { Authorize, SpeechAssetRole } from "../../src/domain/contract.js"
import { ENGINE, VERSION, fixture, invocation, releaseServer, sha, type FixtureOptions, type Serve } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const KITTEN: SpeechAssetRole[] = ["engine", "kitten-model", "kitten-voices", "kitten-config"]
async function setup(o: FixtureOptions & { serve?: (files: Awaited<ReturnType<typeof fixture>>["files"]) => Partial<Record<string, Serve>> } = {}) {
  const server = await releaseServer(); cleanups.push(server.close)
  const f = await fixture({ speech: "missing", release: server.url, ...o }); cleanups.push(f.cleanup)
  server.use(f.files, o.serve?.(f.files))
  const authorize = vi.fn<Authorize>(async () => {}), changed = vi.fn()
  const runtime = await createRuntime(f.options({ authorize })); cleanups.push(() => runtime.close())
  runtime.onAvailabilityChange(changed)
  const name = (role: SpeechAssetRole) => f.files.get(role)!.name
  const bytes = (roles: SpeechAssetRole[]) => roles.reduce((n, role) => n + f.files.get(role)!.content.length, 0)
  /** Everything in the cache: final files and any leftovers (temporary files, locks). */
  const leftovers = async () => (await readdir(f.cache, { recursive: true }).catch(() => [] as string[])).filter(p => p.includes("/")).sort()
  return { ...f, server, authorize, changed, runtime, name, bytes, leftovers }
}

describe("first use", () => {
  test("a speech call asks for the download after its own request, then downloads, verifies and runs", async () => {
    const f = await setup(), host = new URL(f.server.url).host
    const result = await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation())
    expect(result.output).toMatchObject({ durationMs: 500 })
    expect(f.authorize.mock.calls.map(c => c[0])).toEqual([[
      { action: "utilities_speech_synthesize", resources: ["kitten-nano-int8/Luna"], save: ["*"], metadata: { voice: "Luna", characters: 5 } },
      { action: "utilities_speech_download", resources: [host], save: [host], metadata: { bytes: f.bytes(KITTEN), files: KITTEN.map(f.name) } },
    ]])
    for (const role of KITTEN) {
      expect(f.server.requests.get(f.name(role))).toBe(1)
      expect((await lstat(f.cached(role))).mode & 0o777).toBe(role === "engine" ? 0o700 : 0o600)
    }
    expect(f.server.requests.has(f.name("tiny-q5_1"))).toBe(false)
    expect(await f.leftovers()).toEqual(KITTEN.map(role => `${sha(f.files.get(role)!.content)}/${f.name(role)}`).sort())
    expect(f.changed).toHaveBeenCalledTimes(1)
    const status = await f.runtime.status()
    expect(status.speech.assets.map(a => [a.role, a.state])).toEqual([["engine", "cached"], ["tiny-q5_1", "missing"], ["kitten-model", "cached"], ["kitten-voices", "cached"], ["kitten-config", "cached"]])
    expect(status.modules.speech).toEqual({ availability: "SPEECH_ASSETS_MISSING", next: "Run /utilities-speech-install, or approve the download on the first speech call." })
    expect(status.speech.next).toBe(`Run /utilities-speech-install to download 1 file (${(f.bytes(["tiny-q5_1"]) / 1e6).toFixed(1)} MB), or pre-seed speech.assetsDir.`)
  })
  test("a refused download propagates the host's error and downloads nothing", async () => {
    const f = await setup(), denied = { _tag: "Tool.Error", reason: "Denied" }
    f.authorize.mockImplementation(async () => { throw denied })
    await expect(f.runtime.invoke("speech_synthesize", { text: "x" }, invocation())).rejects.toBe(denied)
    expect(f.server.requests.size).toBe(0); expect(await f.leftovers()).toEqual([])
  })
  test("/utilities-speech-install asks once, downloads every file, and is a no-op afterwards", async () => {
    const f = await setup(), authorize = vi.fn(async () => {})
    const result = await f.runtime.installSpeech({ authorize })
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({ downloaded: [...f.files.values()].map(file => ({ name: file.name, bytes: file.content.length })), bytes: f.bytes([...f.files.keys()]), cacheDirectory: f.cache })
    expect(result.text).toBe(`Downloaded 5 files (${(f.bytes([...f.files.keys()]) / 1e6).toFixed(1)} MB) into the speech cache. Speech tools are ready.`)
    const again = await f.runtime.installSpeech({ authorize })
    expect(authorize).toHaveBeenCalledTimes(1); expect(again.text).toBe("All speech files are already installed. Speech tools are ready.")
    expect((await f.runtime.status()).modules.speech).toEqual({ availability: "AVAILABLE" })
  })
  test("a cached file that no longer verifies is downloaded again", async () => {
    const f = await setup(); await f.runtime.installSpeech()
    await writeFile(f.cached("kitten-config"), "corrupted")
    expect((await f.runtime.status()).speech.assets.find(a => a.role === "kitten-config")?.state).toBe("missing")
    await f.runtime.invoke("speech_synthesize", { text: "x" }, invocation())
    expect(f.server.requests.get(f.name("kitten-config"))).toBe(2); expect(await readFile(f.cached("kitten-config"), "utf8")).toBe("synthetic:kitten-config")
  })
})

describe("verification", () => {
  test("a hash mismatch is discarded and the substituted engine is never executed", async () => {
    let marker = ""
    const f = await setup({ serve: files => {
      const real = files.get("engine")!.content
      marker = join(real.toString().match(/appendFileSync\("([^"]+)"/)![1]!, "..", "substituted-engine-ran")
      const evil = Buffer.from(`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n//`)
      return { [ENGINE]: Buffer.concat([evil, Buffer.alloc(real.length - evil.length, "x")]) }
    } })
    const error = await f.runtime.invoke("speech_synthesize", { text: "x" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "INTEGRITY_MISMATCH", message: `The downloaded ${ENGINE} does not match its pinned SHA-256 hash, so it was discarded.` })
    expect(await f.leftovers()).toEqual([])
    expect(await readdir(f.cache)).toEqual([])
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" }); expect(await f.recorded()).toEqual([])
    expect(f.changed).not.toHaveBeenCalled()
  })
  test.each(["short", "long", "length"] as const)("a %s download has the wrong size and leaves nothing", async mode => {
    const f = await setup({ serve: () => ({ [ENGINE]: mode }) })
    await expect(f.runtime.installSpeech()).rejects.toMatchObject({ code: "DOWNLOAD_FAILED", message: expect.stringContaining("wrong size") })
    expect(await f.leftovers()).toEqual([]); expect(await f.recorded()).toEqual([])
  })
  test("an interrupted download leaves no partial file, and a retry completes", async () => {
    const f = await setup({ serve: () => ({ [ENGINE]: "interrupt" }) })
    await expect(f.runtime.installSpeech()).rejects.toMatchObject({ code: "DOWNLOAD_FAILED", message: `Downloading ${ENGINE} was interrupted.` })
    expect(await f.leftovers()).toEqual([])
    f.server.use(f.files)
    await f.runtime.installSpeech()
    expect(await readFile(f.cached("engine"))).toEqual(f.files.get("engine")!.content)
  })
  test("an HTTP error names the status and leaves nothing", async () => {
    const f = await setup({ serve: () => ({ [ENGINE]: "missing" }) })
    await expect(f.runtime.installSpeech()).rejects.toMatchObject({ code: "DOWNLOAD_FAILED", message: `Downloading ${ENGINE} failed with HTTP status 404.` })
    expect(await f.leftovers()).toEqual([])
    expect(await readdir(f.cache)).toEqual([]) // not even an empty folder for the file
  })
  test("cancelling a download removes the partial file", async () => {
    const f = await setup({ serve: () => ({ [ENGINE]: "slow" }) }), controller = new AbortController()
    f.server.hold()
    const work = f.runtime.installSpeech({ signal: controller.signal })
    await vi.waitFor(() => expect(f.server.requests.get(ENGINE)).toBe(1), { timeout: 15000 })
    controller.abort(); f.server.release()
    await expect(work).rejects.toMatchObject({ code: "CANCELLED" })
    expect(await f.leftovers()).toEqual([])
  })
})

describe("concurrency", () => {
  test("concurrent first use downloads each file once, across runtimes", async () => {
    const f = await setup(), second = await createRuntime(f.options()); cleanups.push(() => second.close())
    const [a, b] = await Promise.all([f.runtime.installSpeech(), second.installSpeech()])
    for (const file of f.files.values()) expect(f.server.requests.get(file.name)).toBe(1)
    expect(a.output.downloaded.length + b.output.downloaded.length).toBe(5)
  })
  test("a live lock is waited for; a lock older than the install deadline is taken over", async () => {
    const f = await setup(), lock = join(f.cache, sha(f.files.get("engine")!.content), ".lock")
    await mkdir(lock, { recursive: true, mode: 0o700 })
    const work = f.runtime.installSpeech()
    await new Promise(r => setTimeout(r, 300))
    expect(f.server.requests.has(ENGINE)).toBe(false)
    await rmdir(lock); await work
    expect(f.server.requests.get(ENGINE)).toBe(1)
    await rm(f.cached("engine")); await mkdir(lock, { mode: 0o700 })
    const old = new Date(Date.now() - 2 * 3600000); await utimes(lock, old, old)
    await f.runtime.installSpeech()
    expect(f.server.requests.get(ENGINE)).toBe(2)
  })
})

describe("pre-seed", () => {
  test("pre-seeded files work offline, verified by hash, and nothing is downloaded or asked", async () => {
    const f = await setup({ speech: "preseed" })
    await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation())
    expect(f.server.requests.size).toBe(0)
    expect(f.authorize.mock.calls[0]![0].map(r => r.action)).toEqual(["utilities_speech_synthesize"])
    expect((await f.runtime.status()).speech.assets.every(a => a.state === "pre-seeded")).toBe(true)
    const [call] = await f.recorded()
    expect(call!.request!.payload).toMatchObject({ modelPath: join(f.seed, f.name("kitten-model")) })
  })
  test("a missing or altered pre-seeded file is SPEECH_ASSETS_MISSING, with no prompt and no download", async () => {
    const f = await setup({ speech: "preseed" })
    await rm(join(f.seed, f.name("kitten-voices"))); await writeFile(join(f.seed, f.name("kitten-config")), "altered")
    const error = await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "SPEECH_ASSETS_MISSING", message: `The speech files ${f.name("kitten-voices")}, ${f.name("kitten-config")} are missing from speech.assetsDir, or do not match their pinned hashes.` })
    await expect(f.runtime.installSpeech()).rejects.toMatchObject({ code: "SPEECH_ASSETS_MISSING" })
    expect(f.authorize).not.toHaveBeenCalled(); expect(f.server.requests.size).toBe(0)
    expect((await f.runtime.status()).modules.speech).toEqual({ availability: "SPEECH_ASSETS_MISSING", next: "Copy the missing speech files into speech.assetsDir." })
  })
})

describe("manifest", () => {
  test("a platform without an engine build reports UNSUPPORTED_PLATFORM before any prompt", async () => {
    const f = await setup(), runtime = await createRuntime(f.options({ authorize: f.authorize, target: "linux-x64-gnu" })); cleanups.push(() => runtime.close())
    await expect(runtime.invoke("speech_synthesize", { text: "x" }, invocation())).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM", message: "The speech engine has no build for this platform." })
    expect(f.authorize).not.toHaveBeenCalled()
    expect((await runtime.status()).speech.assets).toEqual([])
    // Cleanup needs no engine, so it still works there.
    expect((await runtime.invoke("speech_cleanup", { text: "um hello there" }, invocation())).output).toEqual({ text: "Hello there", style: "clean", provider: "rules" })
  })
  test("release URLs must be HTTPS, or plain HTTP from loopback only", async () => {
    const f = await setup({ release: `http://example.com/v${VERSION}` })
    await expect(f.runtime.invoke("speech_synthesize", { text: "x" }, invocation())).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" })
    expect((await f.runtime.status()).modules.speech.availability).toBe("CONTRACT_MISMATCH")
  })
})
