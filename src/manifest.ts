import { readFileSync } from "node:fs"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** The installed package: its version for status, and the one `capabilities` manifest the contract reads from disk. */
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { readonly version: string; readonly capabilities: Manifest }

export const manifest: Manifest = pkg.capabilities
export const version: string = pkg.version
