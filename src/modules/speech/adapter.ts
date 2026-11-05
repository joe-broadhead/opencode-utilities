import * as z from "zod"
import { join } from "node:path"
import { lstat } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { stageSource, saveOutput, type OutputTarget } from "../../artifacts/audio.js"
import { parse, fail, fence, text } from "../../domain/common.js"
import { speechOutputs, ttsMeta } from "./contracts.js"
import type { AdapterResult, FailureCode, SpeechAssetRole, SynthesisInput, SynthesisOutput, TranscriptionInput } from "../../domain/contract.js"
import type { Identity } from "../../process/files.js"
import type { ModuleContext } from "../context.js"

const response = z.discriminatedUnion("ok", [
  z.strictObject({ protocolVersion: z.literal(1), requestId: z.string().uuid(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ protocolVersion: z.literal(1), requestId: z.string().uuid(), ok: z.literal(false), error: z.strictObject({ code: z.string().regex(/^[A-Z_]{1,64}$/) }) }),
])
/** Bridge error codes with a more specific failure. Anything else is SPEECH_FAILED, naming the bridge code. */
const BRIDGE: Readonly<Record<string, FailureCode>> = {
  CANCELLED: "CANCELLED", DEADLINE_EXCEEDED: "DEADLINE_EXCEEDED", INVALID_AUDIO: "WAV_INVALID", OUTPUT_EXISTS: "OUTPUT_EXISTS",
  OUTPUT_LIMIT: "OUTPUT_LIMIT", INTEGRITY_MISMATCH: "INTEGRITY_MISMATCH", MODEL_MISSING: "SPEECH_ASSETS_MISSING",
}
/** The operations the speech engine runs. */
export type EngineOperation = "transcribe" | "synthesize"
export interface EngineInputs { transcribe: TranscriptionInput; synthesize: SynthesisInput }
/** What the runtime resolved for this call: verified asset paths, the approved source, and the approved output target. */
export interface SpeechJob {
  readonly assets: ReadonlyMap<SpeechAssetRole, string>
  /** The approved source. `identity` was pinned before the prompt; it is absent when the file could not be identified. */
  readonly source?: { readonly path: string; readonly identity?: Identity }
  readonly output?: OutputTarget
}

export async function invoke<K extends EngineOperation>(op: K, input: EngineInputs[K], ctx: ModuleContext, job: SpeechJob): Promise<AdapterResult> {
  const asset = (role: SpeechAssetRole) => job.assets.get(role) ?? fail("SPEECH_ASSETS_MISSING")
  const engineOutput = join(ctx.stage, "output.wav")
  let payload: unknown
  if (op === "transcribe") {
    const i = input as TranscriptionInput, source = job.source, identity = source?.identity ?? fail("SOURCE_REJECTED")
    payload = { inputPath: await stageSource(source!.path, identity, ctx.stage, ctx.signal), modelPath: asset("tiny-q5_1"), ...i.language ? { language: i.language } : {} }
  } else {
    const i = input as SynthesisInput
    // Checked after approval, so a call cannot probe for files without a prompt; the exclusive create still decides.
    if (job.output && await lstat(job.output.path).then(() => true, () => false)) fail("OUTPUT_EXISTS")
    payload = { text: i.text, outputPath: engineOutput, modelPath: asset("kitten-model"), voicesPath: asset("kitten-voices"), configPath: asset("kitten-config"), ...i.voice ? { voice: i.voice } : {} }
  }
  fence(ctx.signal)
  const requestId = randomUUID()
  const result = parse(response, await ctx.run([], { stdin: JSON.stringify({ protocolVersion: 1, requestId, operation: op, cacheRoot: join(ctx.stage, "speech-cache"), payload }) + "\n" }))
  if (result.requestId !== requestId) fail("BRIDGE_CORRELATION")
  if (!result.ok) {
    const code = BRIDGE[result.error.code]
    return fail(code ?? "SPEECH_FAILED", code ? undefined : { message: `The speech engine failed (${result.error.code}).` })
  }
  if (op === "transcribe") {
    const output = parse(speechOutputs.transcribe, result.result)
    return { output, text: `Transcript (${output.language ?? "unknown language"}, ${output.duration_secs.toFixed(1)} s):\n${output.text || "(no speech recognized)"}` }
  }
  const value = parse(z.strictObject({ meta: ttsMeta, outputPath: text(4096) }), result.result), target = job.output ?? fail("OUTPUT_PATH_MISMATCH")
  if (value.outputPath !== engineOutput) fail("OUTPUT_PATH_MISMATCH")
  const saved = await saveOutput(engineOutput, target, ctx.signal)
  const output: SynthesisOutput = { path: target.path, ...saved, voice: value.meta.voice }
  return { output, text: `Saved ${(output.durationMs / 1000).toFixed(1)} s of speech to ${output.path}. Play it with any audio player (macOS: afplay ${JSON.stringify(output.path)}).` }
}
