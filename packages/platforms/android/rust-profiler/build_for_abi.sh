#!/usr/bin/env bash
set -euo pipefail

ABI=${1:?Usage: ./build_for_abi.sh <arm64-v8a>}

# Fully static musl builds: they run on any Android device (API 23+)
# straight from adb shell, and no Android NDK is required to build them.
# Only arm64-v8a is supported: it covers real devices and the emulator on
# Apple Silicon. The unused ABIs (armeabi-v7a, x86, x86_64) were dropped;
# to bring one back, add its musl target here and in .cargo/config.toml.
case "$ABI" in
  arm64-v8a) TARGET=aarch64-unknown-linux-musl ;;
  *) echo "Unsupported ABI: $ABI (supported: arm64-v8a)" >&2; exit 1 ;;
esac

rustup target add "$TARGET"
cargo build --release --target "$TARGET"
cp "target/$TARGET/release/BAMPerfProfiler" BAMPerfProfiler
