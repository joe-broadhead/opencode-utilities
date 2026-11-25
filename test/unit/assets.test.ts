import { afterEach, describe, expect, test, vi } from "vitest"
import { lstat, mkdir, readdir, readFile, rm, rmdir, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createRuntime } from "../../src/provider/runtime.js"
import type { SpeechAssetRole } from "../../src/domain/contract.js"
import { ENGINE, VERSION, fixture, releaseServer, sha, signal, wav, type FixtureOptions, type Serve } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const KITTEN: SpeechAssetRole[] = ["engine", "kitten-model", "kitten-voices", "kitten-config"]
async function setup(o: FixtureOptions & { serve?: (files: Awaited<ReturnType<typeof fixture>>["files"]) => Partial<Record<string, Serve>> } = {}) {
  const server = await releaseServer(); cleanups.push(server.close)
  const f = await fixture({ speech: "missing", release: server.url, ...o }); cleanups.push(f.cleanup)
  server.use(f.files, o.serve?.(f.files))
  const runtime = await createRuntime(f.options()); cleanups.push(() => runtime.close())
  const name = (role: SpeechAssetRole) => f.files.get(role)!.name
  const bytes = (roles: SpeechAssetRole[]) => roles.reduce((n, role) => n + f.files.get(role)!.content.length, 0)
  /** Everything in the cache: final files and any leftovers (temporary files, locks). */
  // The release programs sit under native/ from the fixture; they are not part of the speech files this lists, or the folder.
  const leftovers = async () => (await readdir(f.cache, { recursive: true }).catch(() => [] as string[])).filter(p => p.includes("/") && !p.startsWith("native/")).sort()
  return { ...f, server, runtime, name, bytes, leftovers }
}

describe("install", () => {
  test("a speech call with missing files refuses SPEECH_ASSETS_MISSING and downloads nothing", async () => {
    const f = await setup()
    await writeFile(join(f.project, "voice.wav"), wav())
    const error = await f.runtime.invoke("speech_transcribe", { path: "voice.wav" }, signal()).catch((e: any) => e)
    expect(error).toMatchObject({ code: "SPEECH_ASSETS_MISSING", hint: "Call tools.utilities.speech_install to download them, then call this tool again." })
    expect(f.server.requests.size).toBe(0)
  })
  test("installSpeech downloads every file once, verifies it, and the speech call then runs", async () => {
    const f = await setup()
    const result = await f.runtime.installSpeech()
    expect(result).toEqual({ downloaded: [...f.files.values()].map(file => ({ name: file.name, bytes: file.content.length })), bytes: f.bytes([...f.files.keys()]), cacheDirectory: f.cache })
    for (const role of KITTEN) {
      expect(f.server.requests.get(f.name(role))).toBe(1)
      expect((await lstat(f.cached(role))).mode & 0o777).toBe(role === "engine" ? 0o700 : 0o600)
    }
    expect(await f.leftovers()).toEqual([...f.files.keys()].map(role => `${sha(f.files.get(role)!.content)}/${f.name(role)}`).sort())
    const status = await f.runtime.status()
    expect(status.speech.assets.map(a => [a.role, a.state])).toEqual([["engine", "cached"], ["tiny-q5_1", "cached"], ["kitten-model", "cached"], ["kitten-voices", "cached"], ["kitten-config", "cached"]])
    expect(status.modules.speech).toEqual({ availability: "AVAILABLE" })
    const synthesis = await f.runtime.invoke("speech_synthesize", { text: "hello" }, signal())
    expect(synthesis).toMatchObject({ durationMs: 500 })
  })
  test("a second install is a no-op", async () => {
    const f = await setup()
    await f.runtime.installSpeech()
    expect(await f.runtime.installSpeech()).toEqual({ downloaded: [], bytes: 0, cacheDirectory: f.cache })
    expect((await f.runtime.status()).modules.speech).toEqual({ availability: "AVAILABLE" })
  })
  test("a cached file that no longer verifies is downloaded again", async () => {
    const f = await setup(); await f.runtime.installSpeech()
    await writeFile(f.cached("kitten-config"), "corrupted")
    expect((await f.runtime.status()).speech.assets.find(a => a.role === "kitten-config")?.state).toBe("missing")
    await f.runtime.installSpeech()
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
    const error = await f.runtime.installSpeech().catch((e: any) => e)
    expect(error).toMatchObject({ code: "INTEGRITY_MISMATCH", message: `The downloaded ${ENGINE} does not match its pinned SHA-256 hash, so it was discarded.` })
    expect(await f.leftovers()).toEqual([])
    expect((await readdir(f.cache)).filter(entry => entry !== "native")).toEqual([])
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" }); expect(await f.recorded()).toEqual([])
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
    expect((await readdir(f.cache)).filter(entry => entry !== "native")).toEqual([]) // not even an empty folder for the file
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
  test("concurrent installs each file once, across runtimes", async () => {
    const f = await setup(), second = await createRuntime(f.options()); cleanups.push(() => second.close())
    const [a, b] = await Promise.all([f.runtime.installSpeech(), second.installSpeech()])
    for (const file of f.files.values()) expect(f.server.requests.get(file.name)).toBe(1)
    expect(a.downloaded.length + b.downloaded.length).toBe(5)
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
  test("pre-seeded files work offline, verified by hash, and nothing is downloaded", async () => {
    const f = await setup({ speech: "preseed" })
    await f.runtime.invoke("speech_synthesize", { text: "hello" }, signal())
    expect(f.server.requests.size).toBe(0)
    expect((await f.runtime.status()).speech.assets.every(a => a.state === "pre-seeded")).toBe(true)
    const [call] = await f.recorded()
    expect(call!.request!.payload).toMatchObject({ modelPath: join(f.seed, f.name("kitten-model")) })
  })
  test("a missing or altered pre-seeded file is SPEECH_ASSETS_MISSING, with no download", async () => {
    const f = await setup({ speech: "preseed" })
    await rm(join(f.seed, f.name("kitten-voices"))); await writeFile(join(f.seed, f.name("kitten-config")), "altered")
    const error = await f.runtime.invoke("speech_synthesize", { text: "hello" }, signal()).catch((e: any) => e)
    expect(error).toMatchObject({ code: "SPEECH_ASSETS_MISSING", message: `The speech files ${f.name("kitten-voices")}, ${f.name("kitten-config")} are missing from speech.assetsDir, or do not match their pinned hashes.` })
    await expect(f.runtime.installSpeech()).rejects.toMatchObject({ code: "SPEECH_ASSETS_MISSING" })
    expect(f.server.requests.size).toBe(0)
    expect((await f.runtime.status()).modules.speech).toEqual({ availability: "SPEECH_ASSETS_MISSING", next: "Copy the missing speech files into speech.assetsDir." })
  })
})

describe("manifest", () => {
  test("a platform without an engine build reports UNSUPPORTED_PLATFORM", async () => {
    const f = await setup(), runtime = await createRuntime(f.options({ target: "linux-x64-gnu" })); cleanups.push(() => runtime.close())
    await expect(runtime.invoke("speech_synthesize", { text: "x" }, signal())).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM", message: "The speech engine has no build for this platform." })
    expect((await runtime.status()).speech.assets).toEqual([])
  })
  test("release URLs must be HTTPS, loopback included", async () => {
    for (const release of [`http://example.com/v${VERSION}`, `http://127.0.0.1:9/v${VERSION}`]) {
      const f = await setup({ release })
      await expect(f.runtime.invoke("speech_synthesize", { text: "x" }, signal())).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" })
      expect((await f.runtime.status()).modules.speech.availability).toBe("CONTRACT_MISMATCH")
    }
  })
})
