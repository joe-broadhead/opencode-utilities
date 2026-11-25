/** What the runtime gives an adapter for one admitted, approved call. */
export interface ModuleContext {
  /** The call's private job directory, removed afterwards. */
  readonly stage: string
  /** This project's timer store. */
  readonly store: string
  /** The tool signal, plugin shutdown and the module deadline. */
  readonly signal: AbortSignal
  /** Runs the module's verified program. `mutation` marks a call whose effect is uncertain once spawned. */
  run(args: readonly string[], options?: { readonly stdin?: string; readonly mutation?: boolean }): Promise<unknown>
}
