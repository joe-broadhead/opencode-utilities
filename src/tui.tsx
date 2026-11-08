import type { Plugin } from "@opencode/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import type { StatusView, TUI_ID } from "./domain/contract.js"
import { isStatus, STATUS_TITLE, Utilities, statusLines } from "./rpc.js"

interface State { readonly view?: StatusView; readonly error?: string; readonly loading: boolean }

/** Server events that can change the status: a reload, agent rules, and the Open-Meteo key. Heard only while the dialog is open; there is no polling. */
const EVENTS = ["server.connected", "agent.updated", "integration.updated", "credential.updated", "credential.switched"] as const

/**
 * The `/utilities` status dialog. It reads only the plugin's `status` RPC method and can change nothing. Keymap layers
 * are registered from setup, where the host's keymap context exists, and in global mode so the palette lists the command.
 */
export default {
  id: "utilities.local.tui" satisfies typeof TUI_ID,
  setup(context) {
    const [state, setState] = createSignal<State>({ loading: true })
    const [open, setOpen] = createSignal(false)
    let closed = false, generation = 0, controller: AbortController | undefined
    const refresh = async () => {
      if (closed) return
      const current = ++generation
      controller?.abort()
      const request = controller = new AbortController()
      setState(previous => ({ ...previous, loading: true }))
      try {
        const view = await context.client.rpc(Utilities).status({}, { location: context.location ?? context.data.location.default(), signal: request.signal })
        if (closed || current !== generation) return
        if (!isStatus(view)) throw new Error("STATUS_UNAVAILABLE: The Utilities server answered with an unexpected status. Next step: Restart OpenCode.")
        setState({ view, loading: false })
      } catch (error) {
        if (!closed && current === generation) setState(previous => ({ ...previous, loading: false, error: error instanceof Error && error.message ? error.message : "STATUS_UNAVAILABLE: The Utilities server part did not answer. Next step: Restart OpenCode." }))
      }
    }
    const View = () => {
      const theme = context.theme
      return <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
        <text fg={theme.text.base}>{STATUS_TITLE}{state().loading ? " · refreshing" : ""}</text>
        <Show when={state().view} fallback={<text fg={theme.text.muted}>{state().loading ? "Loading status…" : `${state().error}`}</text>}>
          {view => <scrollbox maxHeight={28}>
            <box flexDirection="column">
              <For each={statusLines(view(), { paste: true })}>{line =>
                <For each={`${line.label}: ${line.text}`.split("\n")}>{row =>
                  <text fg={line.ok ? theme.text.base : theme.text.feedback.warning.base}>{row}</text>}</For>}</For>
            </box>
          </scrollbox>}
        </Show>
        <Show when={state().view && state().error}><text fg={theme.text.feedback.error.base}>{`Refresh failed: ${state().error}`}</text></Show>
        <text fg={theme.text.muted} onMouseUp={() => void refresh()}>r refresh · esc close</text>
      </box>
    }
    let stops: (() => void)[] = []
    const unsubscribe = () => { for (const stop of stops.splice(0)) stop() }
    const show = () => {
      if (closed) return
      setOpen(true)
      unsubscribe()
      stops = EVENTS.map(type => context.data.on(type, () => void refresh()))
      context.ui.dialog.show(() => <View />, () => { unsubscribe(); setOpen(false) })
      context.ui.dialog.set({ size: "large" })
      void refresh()
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "utilities.status", title: "Utilities: Status", group: "Utilities", palette: true, slash: { name: "utilities" }, run: show },
        { id: "utilities.refresh", title: "Refresh Utilities status", group: "Utilities", bind: "r", enabled: () => open(), run: () => void refresh() },
      ],
    }))
    return () => {
      closed = true
      generation++
      controller?.abort()
      unsubscribe()
      if (open()) context.ui.dialog.clear()
    }
  },
} satisfies Plugin.Definition
