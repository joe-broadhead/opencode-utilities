import type { Plugin } from "@opencode/plugin"
import { COMMANDS, PLUGIN_ID, type Runtime, type StatusView } from "../domain/contract.js"
import { formatStatus } from "../rpc.js"
import { formatFailure, UtilitiesError } from "../domain/common.js"
import { isFailure } from "./errors.js"
import { commandAuthorize } from "./permissions.js"

type CommandEditor = Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]

export interface CommandSources {
  readonly assert: Plugin.Context["permission"]["assert"]
  readonly synthetic: Plugin.Context["session"]["synthetic"]
  readonly runtime: Pick<Runtime, "installSpeech">
  readonly status: () => Promise<StatusView>
  /** Aborts an install in progress when the plugin unloads. */
  readonly signal: AbortSignal
}

const describe = (error: unknown) => {
  if (isFailure(error)) return formatFailure(error)
  const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
  if (tag.startsWith("Permission.")) return `The speech download was not approved${error instanceof Error && error.message ? `: ${error.message}` : "."}`
  return `Failed: ${error instanceof Error ? error.message : String(error)}`
}

/** `/utilities-status` posts the status into the session; `/utilities-speech-install` downloads the speech assets after asking. */
export function commandTransform(sources: CommandSources) {
  const post = (sessionID: string, delivery: Parameters<CommandSources["synthetic"]>[0]["delivery"], text: string, description: string) =>
    sources.synthetic({ sessionID, delivery, text, description, resume: false, metadata: { source: PLUGIN_ID } })
  return (editor: CommandEditor) => {
    editor.add({
      name: COMMANDS.status,
      description: "Utilities status: modules, weather tier, speech models, due timers and permissions",
      async execute({ sessionID, delivery }) {
        let text: string
        try { text = formatStatus(await sources.status()) } catch (error) { text = isFailure(error) ? formatFailure(error) : formatFailure(new UtilitiesError("STATUS_UNAVAILABLE")) }
        await post(sessionID, delivery, text, "Utilities status")
      },
    })
    editor.add({
      name: COMMANDS.speechInstall,
      description: "Download and verify the Utilities speech engine and models (about 105 MB)",
      async execute({ sessionID, delivery }) {
        let text: string
        try {
          text = (await sources.runtime.installSpeech({ signal: sources.signal, authorize: commandAuthorize(sources.assert, sessionID, sources.signal) })).text
        } catch (error) { text = describe(error) }
        await post(sessionID, delivery, text, "Utilities speech download")
      },
    })
  }
}
