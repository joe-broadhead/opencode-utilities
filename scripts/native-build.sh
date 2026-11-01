#!/bin/bash
# Builds the native files for one platform from pinned sources. Developer and release use only; nothing runs on install.
#   time-keep, weather-signal -> npm/opencode-utilities-bin-<platform>/bin/, with its NOTICE and provenance.json
#   the speech engine         -> build/speech-assets/utilities-speech-<platform>, where ONNX Runtime allows one
#   the pinned models         -> build/speech-assets/, on every platform
# Then it regenerates manifest/backends.json and manifest/speech-assets.json from the files present. All of these are
# build outputs, never committed.
#
# Usage: [NATIVE_BUILD_ROOT=<directory>] scripts/native-build.sh [<platform>] [--no-speech]
# NATIVE_BUILD_ROOT holds the source checkouts and cargo's target directory, so later builds are incremental. It
# defaults to a folder in the user cache and must be outside the repository.
# <platform> defaults to this machine. Building for another platform needs its Rust target and a cross linker,
# for example NATIVE_CARGO=zigbuild with cargo-zigbuild. darwin-x64 has no speech engine, because ONNX Runtime
# has no prebuilt static library for it (native/onnx-provenance.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
NATIVE_BUILD_ROOT="${NATIVE_BUILD_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/opencode-utilities-native-build}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-x64 ;;
  Linux-x86_64) PLATFORM=linux-x64-gnu ;;
  Linux-aarch64) PLATFORM=linux-arm64-gnu ;;
  *) PLATFORM= ;;
esac
SPEECH=1
for arg; do
  case "$arg" in
    --no-speech) SPEECH=0 ;;
    darwin-arm64|darwin-x64|linux-x64-gnu|linux-arm64-gnu) PLATFORM="$arg" ;;
    *) echo 'usage: native-build.sh [darwin-arm64|darwin-x64|linux-x64-gnu|linux-arm64-gnu] [--no-speech]' >&2; exit 2 ;;
  esac
done
case "$PLATFORM" in
  darwin-arm64) TARGET=aarch64-apple-darwin ;;
  darwin-x64) TARGET=x86_64-apple-darwin ;;
  linux-x64-gnu) TARGET=x86_64-unknown-linux-gnu ;;
  linux-arm64-gnu) TARGET=aarch64-unknown-linux-gnu ;;
  *) echo "There is no platform package for $(uname -s)-$(uname -m)." >&2; exit 2 ;;
esac
if [[ "$(uname -s)" == Linux && "$PLATFORM" == linux-* ]] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
  echo 'The Linux platform packages target glibc; build them on a glibc system.' >&2; exit 1
fi
mkdir -p "$NATIVE_BUILD_ROOT"
NATIVE_BUILD_ROOT="$(cd "$NATIVE_BUILD_ROOT" && pwd -P)"
case "$NATIVE_BUILD_ROOT" in "$ROOT"|"$ROOT"/*) echo 'NATIVE_BUILD_ROOT must be outside the repository' >&2; exit 1 ;; esac
# Cargo creates its home on first use, but a rustup installed by a package manager may not have created it yet.
mkdir -p "${CARGO_HOME:-$HOME/.cargo}"
CARGO_HOME_DIR="$(cd "${CARGO_HOME:-$HOME/.cargo}" && pwd -P)"
case "$ROOT$NATIVE_BUILD_ROOT$CARGO_HOME_DIR" in *[[:space:]]*) echo 'The repository, NATIVE_BUILD_ROOT and CARGO_HOME paths must not contain spaces' >&2; exit 1 ;; esac

json() { node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))$2 ?? ''" "$1"; }
RUST="$(json "$ROOT/native/sources.json" .rust)"
if ! command -v rustup >/dev/null 2>&1 || ! rustup run "$RUST" cargo --version >/dev/null 2>&1; then
  echo "npm run native:build needs the Rust $RUST toolchain. Install rustup (https://rustup.rs), then run: rustup toolchain install $RUST" >&2
  exit 1
fi
CARGO="${NATIVE_CARGO:-build}"
PKG="$ROOT/npm/opencode-utilities-bin-$PLATFORM"
[[ -f "$PKG/package.json" ]] || { echo "Missing platform package: $PKG" >&2; exit 1; }

unset ORT_LIB_PATH ORT_LIB_LOCATION ORT_PREFER_DYNAMIC_LINK ORT_LIB_PROFILE ORT_LIB_NAME ORT_SKIP_DOWNLOAD ORT_OFFLINE
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS CFLAGS CXXFLAGS CPPFLAGS LDFLAGS
# whisper-rs-sys passes GGML_* to whisper.cpp's CMake: portable CPU code, and no ccache or sccache found on PATH.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" CARGO_TARGET_DIR="$NATIVE_BUILD_ROOT/target" GGML_NATIVE=OFF GGML_CCACHE=OFF
[[ "$PLATFORM" != darwin-* ]] || export MACOSX_DEPLOYMENT_TARGET=14.0
# No builder path reaches a binary: Rust source paths and C/C++ __FILE__ strings are rewritten to fixed prefixes.
RUSTFLAGS='' CFLAGS=''
for map in "$CARGO_HOME_DIR=/cargo" "$NATIVE_BUILD_ROOT=/build" "$ROOT=/utilities"; do
  RUSTFLAGS+=" --remap-path-prefix=$map" CFLAGS+=" -ffile-prefix-map=$map"
done
RUSTFLAGS="${RUSTFLAGS# }" CFLAGS="${CFLAGS# }"
export RUSTFLAGS CFLAGS CXXFLAGS="$CFLAGS"
cargo_build() { cargo "+$RUST" "$CARGO" --locked --release --target "$TARGET" --manifest-path "$1"; }

built=()
for name in time-keep weather-signal; do
  repo="$(json "$ROOT/native/sources.json" ".binaries['$name'].repo")"
  commit="$(json "$ROOT/native/sources.json" ".binaries['$name'].commit")"
  dir="$NATIVE_BUILD_ROOT/src/$name"
  if [[ ! -d "$dir/.git" ]]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$repo"
    git -C "$dir" fetch -q --depth=1 origin "$commit"
    git -C "$dir" checkout -q --detach FETCH_HEAD
  fi
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || { echo "$name: the checkout is not at $commit" >&2; exit 1; }
  [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] || { echo "$name: the checkout has local changes" >&2; exit 1; }
  cmp -s "$dir/Cargo.lock" "$ROOT/native/locks/$name.Cargo.lock" || { echo "$name: Cargo.lock differs from native/locks/$name.Cargo.lock" >&2; exit 1; }
  cmp -s "$dir/LICENSE" "$ROOT/licenses/upstream/$name-MIT.txt" || { echo "$name: LICENSE differs from licenses/upstream/$name-MIT.txt" >&2; exit 1; }
  cargo_build "$dir/Cargo.toml"
  mkdir -p "$PKG/bin"
  install -m 0755 "$CARGO_TARGET_DIR/$TARGET/release/$name" "$PKG/bin/$name"
  built+=("$PKG/bin/$name")
done

speech=()
if (( SPEECH )) && [[ -z "$(json "$ROOT/native/onnx-provenance.json" ".distributions['$TARGET']?.url")" ]]; then
  echo "$PLATFORM has no speech engine: ONNX Runtime has no prebuilt static library for $TARGET."
elif (( SPEECH )); then
  node "$ROOT/scripts/native-onnx.mjs" "$TARGET" "$NATIVE_BUILD_ROOT/onnx/$TARGET"
  ORT_LIB_PATH="$NATIVE_BUILD_ROOT/onnx/$TARGET" ORT_SKIP_DOWNLOAD=1 cargo_build "$ROOT/native/speech-bridge/Cargo.toml"
  mkdir -p "$ROOT/build/speech-assets"
  install -m 0755 "$CARGO_TARGET_DIR/$TARGET/release/utilities-speech" "$ROOT/build/speech-assets/utilities-speech-$PLATFORM"
  speech=(--speech)
  built+=("$ROOT/build/speech-assets/utilities-speech-$PLATFORM")
fi
# The models are the same on every platform, and manifest/speech-assets.json lists them, so fetch them even where
# there is no engine.
node "$ROOT/scripts/native-models.mjs"

node "$ROOT/scripts/native-closure.mjs" "$PLATFORM" "${built[@]}"
node "$ROOT/scripts/native-notices.mjs" "$PLATFORM" "$NATIVE_BUILD_ROOT/src" ${speech[@]+"${speech[@]}"}
node "$ROOT/scripts/native-manifest.mjs" --provenance "$PLATFORM"
node "$ROOT/scripts/native-manifest.mjs"
node "$ROOT/scripts/native-ensure.mjs" --record "$PLATFORM"
