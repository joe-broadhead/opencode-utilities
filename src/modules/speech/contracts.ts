import * as z from "zod"
import { text, finite, integer } from "../../domain/common.js"
import type { SynthesisInput, SynthesisOutput, TranscriptionInput } from "../../domain/contract.js"

const style = z.enum(["raw", "clean", "bullets", "professional", "summary"])
export const speechInputs = {
  transcribe: z.strictObject({
    path: text(4096).min(1).describe("WAV file to transcribe, relative to the project directory or absolute. PCM16, mono or stereo, 8-48 kHz, up to 20 MiB and ten minutes."),
    language: z.string().regex(/^(?:auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/).optional().describe("Spoken language as an ISO code, for example en or pt-BR. Default: detect it."),
  }) satisfies z.ZodType<TranscriptionInput>,
  synthesize: z.strictObject({
    text: text(5000).min(1).describe("Text to speak, up to 5,000 characters."),
    voice: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional().describe("Voice name. utilities_status lists the voices. Default: the engine's default voice."),
    path: text(4096).min(1).refine(p => p.toLowerCase().endsWith(".wav")).optional().describe("Where to write the .wav file, relative to the project directory or absolute. It must not exist yet. Default: the plugin's speech folder."),
  }) satisfies z.ZodType<SynthesisInput>,
}
const segment = z.strictObject({ start: finite.min(0).max(600), end: finite.min(0).max(600), text: text(16000), timestamp_source: z.enum(["native_model", "provider_word", "provider_segment", "chunk_offset", "interpolated", "synthetic_span", "unavailable"]) }).refine(v => v.end >= v.start)
/** The bridge's transcription result, which is also the tool output. */
const stt = z.strictObject({ schema_version: z.literal(2), text: text(48000), language: text(32).nullable(), model: text(128), provider: text(64), duration_secs: finite.min(0).max(600), backend_kind: z.literal("asr"), timestamps_reliable: z.boolean(), cleanup_style: style, cleanup_provider: z.literal("rules").optional(), original_text: text(48000).optional(), original_segments: z.array(segment).max(2000).optional(), cleanup_segment_policy: z.enum(["keep", "clear", "per_segment", "auto"]).optional(), segments: z.array(segment).max(2000), normalization_warnings: z.array(text(256)).max(32).optional(), request_id: integer.nonnegative().optional() })
/** The bridge's synthesis metadata. */
export const ttsMeta = z.strictObject({ schema_version: z.literal(1), sample_rate_hz: integer.min(8000).max(192000), channels: integer.min(1).max(2), backend_kind: text(64), provider: text(64), model: text(128), voice: text(64), language: text(32), duration_ms: integer.min(0).max(600000), text_chars: integer.min(0).max(5000), text_truncated: z.boolean(), chunk_count: integer.min(0).max(1000), synthesized_chars: integer.min(0).max(5000), adapter: text(64).optional(), trust: z.enum(["builtin", "verified", "local_unverified"]).optional(), provenance: z.enum(["builtin", "custom", "local_pack"]).optional() })
export const speechOutputs = {
  transcribe: stt,
  synthesize: z.strictObject({
    path: text(4096),
    bytes: integer.min(44).max(50 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: integer.min(0).max(600000),
    sampleRateHz: integer.min(8000).max(192000),
    channels: integer.min(1).max(2),
    voice: text(64),
  }) satisfies z.ZodType<SynthesisOutput>,
}
