// A fake runtime with the real runtime's permission requests per effect class, so host tests exercise
// the plugin's own mechanism: inserted rules, plain asserts, user rules, saved approvals and reloads.
import { MODULES, SPEECH_DOWNLOAD_ACTION, TOOLS, type Availability, type FailureCode, type Module, type PermissionRequest, type Runtime, type RuntimeOptions, type RuntimeStatus, type ToolName } from "../../src/domain/contract.js"
import { SAMPLES } from "./samples.js"

export const failure = (code: FailureCode, message: string, hint?: string) => Object.assign(new Error(message), { code, ...(hint ? { hint } : {}) })

export interface FakeRuntime extends Runtime {
  readonly options: RuntimeOptions
  readonly calls: { readonly tool: ToolName; readonly input: unknown }[]
  readonly modules: Record<Module, Availability>
  /** Failures to throw, by tool, instead of returning a sample. */
  readonly failures: Map<ToolName, Error>
  closed: boolean
  listenerCount(): number
  setAvailability(module: Module, availability: Availability): void
}

const DOWNLOAD: PermissionRequest = { action: SPEECH_DOWNLOAD_ACTION, resources: ["github.com"], save: ["github.com"], metadata: { bytes: 105_000_000 } }

export function fakeRuntimes(initial: Partial<Record<Module, Availability>> = {}) {
  const created: FakeRuntime[] = []
  const create = async (options: RuntimeOptions): Promise<FakeRuntime> => {
    const listeners = new Set<() => void>()
    const modules = Object.fromEntries(MODULES.map(m => [m, options.modules[m] ? initial[m] ?? "AVAILABLE" : "DISABLED"])) as Record<Module, Availability>
    const emit = () => { for (const listener of listeners) listener() }
    const download = async (authorize?: (requests: readonly PermissionRequest[]) => Promise<void>) => {
      if (modules.speech !== "SPEECH_ASSETS_MISSING") return []
      await authorize?.([DOWNLOAD])
      modules.speech = "AVAILABLE"
      emit()
      return [{ name: "utilities-speech", bytes: 46_000_000 }]
    }
    const status = async (): Promise<RuntimeStatus> => ({
      platform: { target: "darwin-arm64", package: "@joe-broadhead/opencode-utilities-bin-darwin-arm64", availability: "AVAILABLE" },
      modules: Object.fromEntries(MODULES.map(m => [m, modules[m] === "SPEECH_ASSETS_MISSING" ? { availability: modules[m], next: "Run /utilities-speech-install, or set the speech.assetsDir option." } : { availability: modules[m] }])) as RuntimeStatus["modules"],
      speech: {
        assets: [{ role: "engine", name: "utilities-speech", bytes: 46_000_000, state: modules.speech === "SPEECH_ASSETS_MISSING" ? "missing" : "cached" }],
        voices: ["Luna"],
        preseeded: false,
        cacheDirectory: options.cacheRoot,
        outputDirectory: `${options.stateRoot}/speech`,
        ...(modules.speech === "SPEECH_ASSETS_MISSING" ? { next: "Run /utilities-speech-install, or set the speech.assetsDir option." } : {}),
      },
      timers: { due: 0, directory: `${options.stateRoot}/projects` },
    })
    const runtime: FakeRuntime = {
      options, modules, calls: [], failures: new Map(), closed: false,
      listenerCount: () => listeners.size,
      setAvailability(module, availability) { modules[module] = availability; emit() },
      status,
      async invoke(tool, input, invocation) {
        if (runtime.closed) throw failure("CLOSED", "Utilities is shutting down.", "Try again after OpenCode reloads the plugin.")
        runtime.calls.push({ tool, input })
        const { effect, module } = TOOLS[tool]
        // Cleanup is plain TypeScript: only the engine tools need the speech files.
        if (module === "speech" && tool !== "speech_cleanup") await download(requests => options.authorize(requests, invocation))
        const value = input as { name?: string; location?: string; path?: string }
        const requests: PermissionRequest[] =
          effect === "write-state" ? [{ action: `utilities_${tool}` as PermissionRequest["action"], resources: [`timer:${value.name}`], save: ["timer:*"] }]
          : effect === "network" ? [{ action: `utilities_${tool}` as PermissionRequest["action"], resources: ["api.open-meteo.com"], save: ["api.open-meteo.com"], metadata: { location: value.location } }]
          : effect === "read-file" ? [{ action: "read", resources: [value.path ?? ""] }]
          : effect === "write-file" ? [{ action: "utilities_speech_synthesize", resources: [value.path ?? "speech:default"], save: ["*"] }]
          : []
        await options.authorize(requests, invocation)
        if (module === "weather") await options.weatherKey?.()
        const injected = runtime.failures.get(tool)
        if (injected) throw injected
        return structuredClone(SAMPLES[tool as Exclude<ToolName, "status">])
      },
      async installSpeech({ authorize } = {}) {
        const downloaded = await download(authorize)
        return {
          output: { downloaded, bytes: downloaded.reduce((n, f) => n + f.bytes, 0), cacheDirectory: options.cacheRoot },
          text: downloaded.length ? `Downloaded ${downloaded.length} speech file (46.0 MB) to ${options.cacheRoot}. Speech is ready.` : "The speech files are already installed.",
        }
      },
      onAvailabilityChange(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      async close() { runtime.closed = true },
    }
    created.push(runtime)
    return runtime
  }
  return { create, created }
}
