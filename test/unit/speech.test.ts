import { afterEach, describe, expect, test, vi } from "vitest"
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { createRuntime } from "../../src/runtime.js"
import { validateWav } from "../../src/artifacts/wav.js"
import type { Authorize, SynthesisOutput } from "../../src/domain/contract.js"
import { fixture, invocation, wav, type FixtureOptions } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup(o: FixtureOptions = {}) {
  const f = await fixture(o); cleanups.push(f.cleanup)
  const authorize = vi.fn<Authorize>(async () => {})
  const runtime = await createRuntime(f.options({ authorize })); cleanups.push(() => runtime.close())
  return { ...f, authorize, runtime }
}
const bridge = (reply: string) => `let input = ''; process.stdin.on('data', v => input += v); process.stdin.on('end', () => { const r = JSON.parse(input); record({ request: r }); ${reply} })`

describe("synthesis", () => {
  test("the engine gets a private job cache and no time or weather config", async () => {
    const f = await setup()
    await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation())
    const [call] = await f.recorded()
    expect(call!.files).not.toContain("empty.toml"); expect(call!.request!.cacheRoot).toBe(join(call!.cwd, "speech-cache"))
  })
  test("synthesis writes a valid, playable WAV in the private default directory and says how to play it", async () => {
    const f = await setup()
    const { output, text } = await f.runtime.invoke("speech_synthesize", { text: "hello" }, invocation()) as { output: SynthesisOutput; text: string }
    expect(output.path).toMatch(new RegExp(`^${join(f.state, "speech")}/[a-f0-9]{64}/[a-f0-9-]{36}\\.wav$`))
    const bytes = await readFile(output.path)
    expect(validateWav(bytes)).toEqual({ sampleRate: 16000, channels: 1, duration: 0.5 })
    expect(output).toEqual({ path: output.path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), durationMs: 500, sampleRateHz: 16000, channels: 1, voice: "Luna" })
    expect((await lstat(output.path)).mode & 0o777).toBe(0o600)
    expect(text).toBe(`Saved 0.5 s of speech to ${output.path}. Play it with any audio player (macOS: afplay ${JSON.stringify(output.path)}).`)
    expect(f.authorize.mock.calls.map(c => c[0])).toEqual([[{ action: "utilities_speech_synthesize", resources: ["kitten-nano-int8/Luna"], save: ["*"], metadata: { voice: "Luna", characters: 5 } }]])
  })
  test("the bridge receives each verified Kitten file by its own cached path", async () => {
    const f = await setup()
    await f.runtime.invoke("speech_synthesize", { text: "hello", voice: "Bella" }, invocation())
    const [call] = await f.recorded()
    expect(call!.request!.payload).toMatchObject({ modelPath: f.cached("kitten-model"), voicesPath: f.cached("kitten-voices"), configPath: f.cached("kitten-config"), voice: "Bella" })
  })
  test("a voice that does not exist is refused before any prompt, naming the eight voices (UTIL-R8)", async () => {
    const f = await setup()
    const error = await f.runtime.invoke("speech_synthesize", { text: "hello", voice: "Nobody" }, invocation()).catch(e => e)
    expect(error).toMatchObject({ code: "INPUT_INVALID", message: expect.stringContaining('"Bella"|"Jasper"|"Luna"|"Bruno"|"Rosie"|"Hugo"|"Kiki"|"Leo"') })
    expect(f.authorize).not.toHaveBeenCalled(); expect(await f.recorded()).toEqual([])
  })
  test("a bridge answer for another request, or an output elsewhere, is refused", async () => {
    const f = await setup({ body: bridge(`out({ protocolVersion: 1, requestId: '00000000-0000-4000-8000-000000000000', ok: true, result: {} })`) })
    await expect(f.runtime.invoke("speech_synthesize", { text: "private" }, invocation())).rejects.toMatchObject({ code: "BRIDGE_CORRELATION" })
    const g = await setup({ body: bridge(`out({ protocolVersion: 1, requestId: r.requestId, ok: true, result: { outputPath: '/foreign/path.wav', meta: { schema_version: 1, sample_rate_hz: 16000, channels: 1, backend_kind: 'local', provider: 'local', model: 'kitten', voice: 'Luna', language: 'en', duration_ms: 100, text_chars: 1, text_truncated: false, chunk_count: 1, synthesized_chars: 1 } } })`) })
    await expect(g.runtime.invoke("speech_synthesize", { text: "x" }, invocation())).rejects.toMatchObject({ code: "OUTPUT_PATH_MISMATCH" })
  })
  test("bridge error codes map to specific failures, and others name the bridge code", async () => {
    const f = await setup({ body: bridge(`out({ protocolVersion: 1, requestId: r.requestId, ok: false, error: { code: r.payload.text === 'audio' ? 'INVALID_AUDIO' : 'INFERENCE_FAILED' } })`) })
    await expect(f.runtime.invoke("speech_synthesize", { text: "audio" }, invocation())).rejects.toMatchObject({ code: "WAV_INVALID" })
    await expect(f.runtime.invoke("speech_synthesize", { text: "other" }, invocation())).rejects.toMatchObject({ code: "SPEECH_FAILED", message: "The speech engine failed (INFERENCE_FAILED)." })
  })
})

describe("WAV admission", () => {
  const chunk = (type: string, body: Buffer) => Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(Uint32Array.of(body.length).buffer), body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
  const riff = (...chunks: Buffer[]) => { const body = Buffer.concat([Buffer.from("WAVE"), ...chunks]); return Buffer.concat([Buffer.from("RIFF"), Buffer.from(Uint32Array.of(body.length).buffer), body]) }
  const pcm = wav(), fmt = pcm.subarray(20, 36), data = pcm.subarray(44)
  test("ancillary chunks such as macOS FLLR padding are skipped, as the engine's decoder does", () => {
    expect(validateWav(riff(chunk("JUNK", Buffer.alloc(28)), chunk("fmt ", fmt), chunk("FLLR", Buffer.alloc(4008)), chunk("data", data), chunk("bext", Buffer.alloc(3))))).toEqual({ sampleRate: 16000, channels: 1, duration: 0.1 })
  })
  test("the PCM16 bounds still hold: one fmt before one data, no trailing bytes", () => {
    expect(() => validateWav(riff(chunk("data", data), chunk("fmt ", fmt)))).toThrow(expect.objectContaining({ code: "WAV_INVALID" }))
    expect(() => validateWav(riff(chunk("fmt ", fmt), chunk("fmt ", fmt), chunk("data", data)))).toThrow(expect.objectContaining({ code: "WAV_UNSUPPORTED" }))
    expect(() => validateWav(riff(chunk("fmt ", fmt), chunk("data", data), chunk("data", data)))).toThrow(expect.objectContaining({ code: "WAV_INVALID" }))
    expect(() => validateWav(Buffer.concat([riff(chunk("fmt ", fmt), chunk("data", data)), Buffer.alloc(2)]))).toThrow(expect.objectContaining({ code: "WAV_INVALID" }))
  })
})

describe("files the user names", () => {
  test("transcription reads a location-relative WAV under the host's read rule", async () => {
    const f = await setup(); await mkdir(join(f.project, "audio")); await writeFile(join(f.project, "audio/in.wav"), wav())
    const result = await f.runtime.invoke("speech_transcribe", { path: "audio/in.wav", language: "en" }, invocation())
    // Only the transcript, its language and duration, and its timed parts: no engine metadata (UTIL-R22).
    expect(result.output).toEqual({ text: "synthetic transcript", language: "en", duration_secs: 0.1, segments: [{ start: 0, end: 0.1, text: "synthetic transcript" }] })
    expect(result.text).toBe("Transcript (en, 0.1 s):\nsynthetic transcript")
    const [call] = await f.recorded()
    expect(call!.request!.payload).toMatchObject({ modelPath: f.cached("tiny-q5_1"), language: "en" }); expect(call!.files).toContain("input.wav")
  })
  test("a source swapped while the prompt waits is refused and never transcribed", async () => {
    const f = await setup(), source = join(f.project, "in.wav"); await writeFile(source, wav())
    f.authorize.mockImplementation(async () => { await rm(source); await writeFile(source, wav()) })
    await expect(f.runtime.invoke("speech_transcribe", { path: "in.wav" }, invocation())).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
    expect(await f.recorded()).toEqual([])
  })
  test("a missing or linked source fails only after the prompt, so calls cannot probe for files", async () => {
    const f = await setup(); await writeFile(join(f.root, "real.wav"), wav()); await symlink(join(f.root, "real.wav"), join(f.project, "link.wav"))
    await expect(f.runtime.invoke("speech_transcribe", { path: "absent.wav" }, invocation())).rejects.toMatchObject({ code: "SOURCE_REJECTED" })
    await expect(f.runtime.invoke("speech_transcribe", { path: "link.wav" }, invocation())).rejects.toMatchObject({ code: "SOURCE_REJECTED" })
    expect(f.authorize).toHaveBeenCalledTimes(2); expect(await f.recorded()).toEqual([])
  })
  test("an invalid WAV is refused before the engine runs", async () => {
    const f = await setup(); await writeFile(join(f.project, "bad.wav"), Buffer.from("RIFF not really a wav file at all, padded to forty-four bytes"))
    await expect(f.runtime.invoke("speech_transcribe", { path: "bad.wav" }, invocation())).rejects.toMatchObject({ code: "WAV_INVALID" })
    expect(await f.recorded()).toEqual([])
  })
  test("synthesis to a named path writes there, never replaces a file, and needs a .wav name", async () => {
    const f = await setup()
    const { output } = await f.runtime.invoke("speech_synthesize", { text: "hello", path: "out/hello.wav" }, invocation()) as { output: SynthesisOutput }
    expect(output.path).toBe(join(f.project, "out/hello.wav")); expect(validateWav(await readFile(output.path)).duration).toBe(0.5)
    await expect(f.runtime.invoke("speech_synthesize", { text: "again", path: "out/hello.wav" }, invocation())).rejects.toMatchObject({ code: "OUTPUT_EXISTS" })
    expect((await f.recorded()).filter(c => c.request?.operation === "synthesize")).toHaveLength(1)
    await expect(f.runtime.invoke("speech_synthesize", { text: "hello", path: "out/hello.mp3" }, invocation())).rejects.toMatchObject({ code: "INPUT_INVALID" })
    expect(f.authorize).toHaveBeenCalledTimes(2)
  })
})
