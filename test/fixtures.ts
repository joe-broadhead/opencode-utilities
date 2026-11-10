import { readFileSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import { PLATFORMS, type Authorize, type RuntimeOptions, type SpeechAssetManifest, type SpeechAssetRole } from "../src/domain/contract.js"

/** The package version, read from package.json. */
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version
export const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex")
export const invocation = (signal = new AbortController().signal) => ({ sessionID: "session-original", agent: "agent-original", messageID: "message-original", id: "call-original", signal })
export const calendar = { date: "2026-10-29", weekday: "Thursday", weekday_number_from_monday: 4, iso_week: 44, iso_year: 2026, day_of_year: 302, days_in_month: 31, leap_year: false, quarter: 4 }
export const place = { id: null, name: "Synthetic", country: null, country_code: null, admin1: null, latitude: -33, longitude: 18, timezone: "Africa/Johannesburg", population: null }
export const weatherBase = { source: "open-meteo", location: place, fetched_at: "2026-10-29T12:00:00Z", cache: "miss", timezone: "Africa/Johannesburg" }
const current = { time: "2026-10-29T12:00", interval: 900, temperature_2m: 21, relative_humidity_2m: 50, apparent_temperature: 20, precipitation: 0, rain: 0, showers: 0, snowfall: 0, weather_code: 1, cloud_cover: 10, wind_speed_10m: 12, wind_gusts_10m: 20 }
export function wav(seconds = 0.1) {
  const data = Math.round(16000 * seconds) * 2, b = Buffer.alloc(44 + data)
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(data, 40); return b
}
export const MODELS = { "tiny-q5_1": "ggml-tiny-q5_1.bin", "kitten-model": "kitten_tts_nano_v0_8.onnx", "kitten-voices": "voices.npz", "kitten-config": "config.json" } as const
export const ENGINE = "utilities-speech-darwin-arm64"

// SYNTHETIC programs. One script plays time-keep and weather-signal (argv) and the speech bridge (stdin protocol).
// It records every call; hashes verify these fixtures, never upstream native code.
const DEFAULT = `
if (argv.length) {
  record({})
  const data = argv.find(x => x.startsWith('--data-dir='))?.slice(11), cmd = argv.filter(x => !x.startsWith('--'))
  const fail = v => { process.stderr.write(JSON.stringify(v)); process.exitCode = 1 }
  if (cmd[0] === 'calendar') out(${JSON.stringify(calendar)})
  else if (cmd[0] === 'timer') {
    const file = path.join(data, 'synthetic-timers.json'), list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [], action = cmd[1], name = cmd[2]
    const missing = () => fail({ error: { error_code: 'INVALID_PARAMS', message: 'timer not found: ' + name, details: { parameter: 'name', value: name } } })
    if (action === 'set') { const old = list.find(x => x.name === name); const item = { name, deadline_utc: cmd[3], original_deadline: cmd[3], timezone: 'UTC', tags: [], created_at_utc: '2026-10-29T12:00:00Z', updated_at_utc: '2026-10-29T12:00:00Z', status: 'pending', overdue: false, remaining_seconds: 100, remaining: '100s' }; if (old) list.splice(list.indexOf(old), 1); list.push(item); fs.writeFileSync(file, JSON.stringify(list)); out(item) }
    else if (action === 'list') out({ count: list.length, timers: list })
    else if (action === 'get') { const item = list.find(x => x.name === name); item ? out(item) : missing() }
    else if (action === 'delete') { const index = list.findIndex(x => x.name === name); if (index < 0) missing(); else { list.splice(index, 1); fs.writeFileSync(file, JSON.stringify(list)); out({ name, deleted: true, deleted_tags: 0 }) } }
    else { const due = list.filter(x => x.deadline_utc < '2026-01-01'); out({ generated_at_utc: '2026-10-29T12:00:00Z', count: due.length, timers: due }) }
  }
  else if (process.env.OPEN_METEO_API_KEY === 'rejected-key') fail({ causes: ['API returned status 401 Unauthorized: invalid key'], error: 'weather request failed after 1 attempt(s)' })
  else if (cmd[1] === 'Nowhere') fail({ causes: [], error: 'no geocoding result for "Nowhere"' })
  else if (cmd[0] === 'geocode') out([${JSON.stringify(place)}])
  else if (cmd[0] === 'current') out({ ...${JSON.stringify(weatherBase)}, current: ${JSON.stringify(current)} })
  else fail({ error: 'unexpected synthetic command' })
} else {
  let input = ''
  process.stdin.on('data', v => input += v)
  process.stdin.on('end', () => {
    const r = JSON.parse(input), p = r.payload; record({ request: r })
    const model = (file, role) => fs.readFileSync(file, 'utf8') === 'synthetic:' + role
    const reply = result => out({ protocolVersion: 1, requestId: r.requestId, ok: true, result })
    const error = code => out({ protocolVersion: 1, requestId: r.requestId, ok: false, error: { code } })
    if (r.operation === 'transcribe') model(p.modelPath, 'tiny-q5_1') ? reply({ schema_version: 2, text: 'synthetic transcript', language: 'en', model: 'tiny-q5_1', provider: 'local', duration_secs: 0.1, backend_kind: 'asr', timestamps_reliable: true, cleanup_style: 'raw', segments: [{ start: 0, end: 0.1, text: 'synthetic transcript', timestamp_source: 'native_model' }] }) : error('MODEL_MISSING')
    else if (!model(p.modelPath, 'kitten-model') || !model(p.voicesPath, 'kitten-voices') || !model(p.configPath, 'kitten-config')) error('MODEL_MISSING')
    else { fs.writeFileSync(p.outputPath, Buffer.from('${wav(0.5).toString("base64")}', 'base64')); reply({ outputPath: p.outputPath, meta: { schema_version: 1, sample_rate_hz: 16000, channels: 1, backend_kind: 'local', provider: 'local', model: 'kitten', voice: p.voice ?? 'Luna', language: 'en', duration_ms: 500, text_chars: p.text.length, text_truncated: false, chunk_count: 1, synthesized_chars: p.text.length } }) }
  })
}`
function program(calls: string, body = DEFAULT) {
  return `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), argv = process.argv.slice(2)
const record = v => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ program: path.basename(__filename), argv, env: process.env, cwd: process.cwd(), files: fs.readdirSync(process.cwd()), ...v }) + '\\n')
const out = v => process.stdout.write(JSON.stringify(v))
${body}`
}

export interface FixtureOptions {
  /** Replaces the synthetic program's behaviour. */
  readonly body?: string
  /** Where the speech files start: in the download cache (default), nowhere, or in a pre-seed directory. */
  readonly speech?: "cached" | "missing" | "preseed"
  /** The release base URL written into manifest/speech-assets.json. */
  readonly release?: string
  /** Replaces the engine bytes the manifest pins (and the server serves). */
  readonly engine?: string
}
export type Fixture = Awaited<ReturnType<typeof fixture>>
export async function fixture(o: FixtureOptions = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "utilities-synthetic-")), calls = join(root, "calls.jsonl")
  const code = program(calls, o.body)
  await mkdir(join(root, "manifest")); await mkdir(join(root, "state"), { mode: 0o700 }); await mkdir(join(root, "project"))
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "github:joe-broadhead/opencode-utilities#v0.0.0", version: VERSION }))
  const gz = gzipSync(Buffer.from(code), { level: 9 })
  const native = (module: string) => ({ name: `${module}-darwin-arm64.gz`, url: `https://github.com/joe-broadhead/opencode-utilities/releases/download/v${VERSION}/${module}-darwin-arm64.gz`, bytes: gz.length, sha256: sha(gz), executable: { name: module, bytes: Buffer.byteLength(code), sha256: sha(code) } })
  await writeFile(join(root, "manifest/native.json"), JSON.stringify({ schema: 1, plugin: "opencode-utilities", repository: "joe-broadhead/opencode-utilities", tag: `v${VERSION}`, built: { commit: "0".repeat(40), run: 0, workflow: "native" }, modules: { "time-keep": { "darwin-arm64": native("time-keep") }, "weather-signal": { "darwin-arm64": native("weather-signal") } } }))
  const files = new Map<SpeechAssetRole, { name: string; content: Buffer }>([["engine", { name: ENGINE, content: Buffer.from(o.engine ?? code) }]])
  for (const [role, name] of Object.entries(MODELS)) files.set(role as SpeechAssetRole, { name, content: Buffer.from(`synthetic:${role}`) })
  const release = o.release ?? `https://github.com/joe-broadhead/opencode-utilities/releases/download/v${VERSION}`
  const asset = (role: SpeechAssetRole) => { const f = files.get(role)!; return { name: f.name, url: `${release}/${f.name}`, sha256: sha(f.content), bytes: f.content.length } }
  const speech: SpeechAssetManifest = { engines: { "darwin-arm64": asset("engine") }, models: { "tiny-q5_1": asset("tiny-q5_1"), "kitten-model": asset("kitten-model"), "kitten-voices": asset("kitten-voices"), "kitten-config": asset("kitten-config") } }
  await writeFile(join(root, "manifest/speech-assets.json"), JSON.stringify(speech))
  const cache = join(root, "cache"), seed = join(root, "seed")
  // The synthetic programs sit where the first-use cache looks for them, so no call downloads anything.
  for (const module of ["time-keep", "weather-signal"]) {
    const program = join(cache, "native", `v${VERSION}`, module, "darwin-arm64", module)
    await mkdir(dirname(program), { recursive: true, mode: 0o700 }); await writeFile(program, code, { mode: 0o755 }); await chmod(program, 0o755)
  }
  const cached = (role: SpeechAssetRole) => join(cache, sha(files.get(role)!.content), files.get(role)!.name)
  /** Where the verified program for a module sits in the cache, where the first-use path looks for it. */
  const binary = (module: "time-keep" | "weather-signal") => join(cache, "native", `v${VERSION}`, module, "darwin-arm64", module)
  /** The release files for the two programs: the gzip of each, under the names the native manifest pins. */
  const nativeFiles = ["time-keep", "weather-signal"].map(module => ({ name: `${module}-darwin-arm64.gz`, content: gz }))
  for (const [role, file] of files) {
    if ((o.speech ?? "cached") === "missing") break
    const path = o.speech === "preseed" ? join(seed, file.name) : cached(role)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, file.content); await chmod(path, role === "engine" ? 0o700 : 0o600)
  }
  return {
    root, calls, cache, seed, files, speech, cached, binary, nativeFiles,
    project: join(root, "project"), state: join(root, "state"),
    options(extra: Partial<Omit<RuntimeOptions, "authorize">> & { authorize?: Authorize } = {}): RuntimeOptions {
      return {
        location: { project: "project-a", directory: join(root, "project"), projectDirectory: join(root, "project") }, authorize: async () => {},
        modules: { weather: true, time: true, speech: true }, stateRoot: join(root, "state"), cacheRoot: cache,
        target: "darwin-arm64", packageRoot: root, ...o.speech === "preseed" ? { speechAssetsDir: seed } : {}, ...extra,
      }
    },
    async recorded(): Promise<Array<{ program: string; argv: string[]; env: Record<string, string>; cwd: string; files: string[]; request?: { operation: string; cacheRoot: string; payload: Record<string, unknown> } }>> {
      try { return (await readFile(calls, "utf8")).trim().split("\n").map(line => JSON.parse(line)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error }
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** How the release server answers for one file. A Buffer is served in place of the real bytes. */
export type Serve = "ok" | "tampered" | "short" | "long" | "length" | "interrupt" | "missing" | "slow" | Buffer
/**
 * A local stand-in for the GitHub release, counting requests per file. Call `use` with the fixture's files. The
 * manifest keeps the real HTTPS release URL (`url`); until `close`, fetch sends requests for it to this server.
 */
export async function releaseServer() {
  let byName = new Map<string, Buffer>(), behaviour: Partial<Record<string, Serve>> = {}
  const requests = new Map<string, number>()
  let hold: Promise<void> = Promise.resolve(), release = () => {}
  const server: Server = createServer((req, res) => {
    const name = req.url!.split("/").pop()!, content = byName.get(name)
    requests.set(name, (requests.get(name) ?? 0) + 1)
    const mode = behaviour[name] ?? "ok"
    if (!content || mode === "missing") { res.writeHead(404); res.end(); return }
    if (Buffer.isBuffer(mode)) { res.writeHead(200, { "content-length": mode.length }); res.end(mode); return }
    if (mode === "tampered") { const bad = Buffer.from(content); bad[0] = bad[0]! ^ 0xff; res.writeHead(200, { "content-length": bad.length }); res.end(bad); return }
    if (mode === "short") { const body = content.subarray(0, content.length - 1); res.writeHead(200, { "content-length": body.length }); res.end(body); return }
    if (mode === "long") { const body = Buffer.concat([content, Buffer.from("x")]); res.writeHead(200); res.end(body); return }
    if (mode === "length") { res.writeHead(200, { "content-length": content.length + 10 }); res.end(Buffer.concat([content, Buffer.alloc(10)])); return }
    if (mode === "interrupt") { res.writeHead(200, { "content-length": content.length }); res.write(content.subarray(0, Math.floor(content.length / 2)), () => res.socket?.destroy()); return }
    if (mode === "slow") { res.writeHead(200, { "content-length": content.length }); void hold.then(() => res.end(content)); return }
    res.writeHead(200, { "content-length": content.length }); res.end(content)
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const url = `https://github.com/joe-broadhead/opencode-utilities/releases/download/v${VERSION}`, local = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v${VERSION}`
  const realFetch = globalThis.fetch
  globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => realFetch(typeof input === "string" && input.startsWith(`${url}/`) ? local + input.slice(url.length) : input, init), realFetch)
  return {
    url, requests,
    use(files: ReadonlyMap<SpeechAssetRole, { name: string; content: Buffer }>, modes: Partial<Record<string, Serve>> = {}) {
      byName = new Map([...files.values()].map(f => [f.name, f.content])); behaviour = modes
    },
    /** Adds release files without replacing the others: the native programs, next to the speech files. */
    add(files: ReadonlyArray<{ name: string; content: Buffer }>) { for (const file of files) byName.set(file.name, file.content) },
    /** Sets how the server answers one file, for example `tampered`. */
    serve(name: string, mode: Serve) { behaviour[name] = mode },
    /** Holds `slow` responses until `release()`. */
    hold() { hold = new Promise(resolve => { release = resolve }) },
    release: () => release(),
    close: () => new Promise<void>(resolve => { globalThis.fetch = realFetch; server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
