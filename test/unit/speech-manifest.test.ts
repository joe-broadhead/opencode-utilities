import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// manifest/speech-assets.json is committed and pinned here. The seven files are the v0.0.7 release's, carried to v0.0.0 with
// the same bytes (NATIVE-DESIGN.md, section 1): the three speech engines and the four models. A change to a pin is a deliberate
// edit to this test as well, made with `npm run speech:manifest -- --from <folder of the release files>`.
const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
const RELEASE = "https://github.com/joe-broadhead/opencode-utilities/releases/download/v0.0.0/"
const file = (name: string, bytes: number, sha256: string) => ({ name, url: `${RELEASE}${name}`, sha256, bytes })

const PINNED = {
  engines: {
    "darwin-arm64": file("utilities-speech-darwin-arm64", 45544912, "1cef11dbba30ac744609cfc5076dc078fa1653c8e2b1807739d7ce5924248665"),
    "linux-x64-gnu": file("utilities-speech-linux-x64-gnu", 50826920, "21c6812369dd7c52c083624acd4a5b88ecbcdc15c31d33b0273a71b575024430"),
    "linux-arm64-gnu": file("utilities-speech-linux-arm64-gnu", 50282600, "d9d1ddd200a8fc3335803b87641de6da22c28ac143cfc231ef9bc2101db325f7"),
  },
  models: {
    "tiny-q5_1": file("ggml-tiny-q5_1.bin", 32152673, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"),
    "kitten-model": file("kitten_tts_nano_v0_8.onnx", 24369971, "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc"),
    "kitten-voices": file("kitten_tts_nano_v0_8-voices.npz", 3278902, "8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f"),
    "kitten-config": file("kitten_tts_nano_v0_8-config.json", 688, "b66006ccbeccd4de5fc3c9272059c47f5725df7215fd889785c03602652fab64"),
  },
}

describe("the committed speech manifest", () => {
  test("pins exactly the seven v0.0.7 files, at v0.0.0 URLs, with their sizes and SHA-256s", () => {
    expect(JSON.parse(read("manifest/speech-assets.json"))).toEqual(PINNED)
  })

  test("names no earlier release", () => {
    expect(read("manifest/speech-assets.json")).not.toContain("v0.0.7")
  })

  test("is tracked: the .gitignore no longer ignores it", () => {
    expect(read(".gitignore").split("\n")).not.toContain("manifest/speech-assets.json")
  })

  test("no build, pack or release step writes it: only the maintainer command names it as a file to write", () => {
    const steps = ["scripts/native-files.mjs", "scripts/native-ensure.mjs", "scripts/native-build.sh", "scripts/build.mjs", "scripts/pack.mjs", "scripts/release-pack.mjs", "scripts/release-commit.mjs", "scripts/publish-release.mjs"]
    for (const path of steps) expect({ path, names: /["'`]manifest\/speech-assets\.json["'`]/.test(read(path)) }).toEqual({ path, names: false })
  })

  test("the maintainer command is the one writer, and it is documented", () => {
    expect(JSON.parse(read("package.json")).scripts["speech:manifest"]).toBe("node scripts/speech-manifest.mjs")
    expect(read("CONTRIBUTING.md")).toContain("npm run speech:manifest")
  })
})
