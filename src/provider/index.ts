import type { Plugin } from "@opencode/plugin"
import type { ResolvedConfig } from "../domain/config.js"
import type { DiagnoseView, ModuleTool, NativeInstallOutput, Runtime, RuntimeStatus, SpeechInstallOutput } from "../domain/contract.js"
import { grep, sessions, type GrepSource, type SessionSource } from "./modules/sessions/adapter.js"
import type { GrepOutput, SessionsOutput } from "./modules/sessions/contracts.js"
import { createRuntime } from "./runtime.js"
import { createWeatherKey, registerWeatherIntegration, type WeatherKey } from "./weather.js"

/**
 * The provider client: every call that leaves the plugin's own code goes through here. It owns the local programs
 * (time-keep, weather-signal, the speech engine), the Open-Meteo key, and the two read-only session sources that OpenCode
 * itself answers. Handlers only ask it for an answer.
 */
export interface Provider {
  /** One module tool, through the runtime's input check, availability check and queue. */
  invoke(tool: ModuleTool, input: unknown, signal: AbortSignal): Promise<unknown>
  /** What this machine has: program and speech-file availability, the platform, and due timers. */
  runtimeStatus(signal?: AbortSignal): Promise<RuntimeStatus>
  /** The Open-Meteo tier and key state. */
  weatherStatus(): Promise<DiagnoseView["weather"]>
  /** After a weather call: mark the key rejected, or clear that once it works. Never throws. */
  settleWeather(rejected: boolean): Promise<void>
  /** Status and totals over the public session API. */
  sessions(input: unknown): Promise<SessionsOutput>
  /** Exact text in OpenCode's database, read-only and masked. */
  grep(input: unknown): Promise<GrepOutput>
  /** The time and weather programs, from the plugin's release. */
  installNatives(signal: AbortSignal): Promise<NativeInstallOutput>
  /** The on-device speech engine and models, from the plugin's release. */
  installSpeech(signal: AbortSignal): Promise<SpeechInstallOutput>
  close(): Promise<void>
}

export interface ProviderInput {
  readonly context: Plugin.Context
  readonly config: ResolvedConfig
  /** The installed package root, which holds manifest/ and package.json. */
  readonly packageRoot: string
}

export async function createProvider({ context, config, packageRoot }: ProviderInput): Promise<Provider> {
  const weather = createWeatherKey(context.integration)
  const runtime: Runtime = await createRuntime({
    location: { project: context.location.project.id, directory: context.location.directory, projectDirectory: context.location.project.directory },
    modules: config.modules,
    stateRoot: config.stateRoot,
    cacheRoot: config.cacheRoot,
    ...(config.speechAssetsDir ? { speechAssetsDir: config.speechAssetsDir } : {}),
    weatherKey: () => weather.key(),
    packageRoot,
  })
  const source: SessionSource = {
    list: input => context.session.list(input),
    get: input => context.session.get(input),
    directory: context.location.directory,
  }
  const database: GrepSource = { databasePath: config.sessionsDatabasePath }
  try {
    await registerWeatherIntegration(context.integration)
  } catch (error) {
    await runtime.close().catch(() => undefined)
    throw error
  }
  return {
    invoke: (tool, input, signal) => runtime.invoke(tool, input, signal),
    runtimeStatus: signal => runtime.status(signal),
    weatherStatus: () => weather.status(),
    settleWeather: rejected => weather.settle(rejected),
    sessions: input => sessions(input, source),
    grep: input => grep(input, database),
    installNatives: signal => runtime.installNatives({ signal }),
    installSpeech: signal => runtime.installSpeech({ signal }),
    close: () => runtime.close(),
  }
}
