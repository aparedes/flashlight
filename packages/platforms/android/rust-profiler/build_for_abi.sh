#!/usr/bin/env bash
set -euo pipefail

ABI=${1:?Usage: ./build_for_abi.sh <arm64-v8a|x86_64>}

# Fully static musl builds: they run on any Android device (API 23+)
# straight from adb shell, and no Android NDK is required to build them.
# Only the ABIs in actual use are supported: arm64-v8a covers real devices,
# x86_64 covers emulators. 32-bit ABIs (armeabi-v7a, x86) were dropped.
case "$ABI" in
  arm64-v8a) TARGET=aarch64-unknown-linux-musl ;;
  x86_64)    TARGET=x86_64-unknown-linux-musl ;;
  *) echo "Unsupported ABI: $ABI (supported: arm64-v8a, x86_64)" >&2; exit 1 ;;
esac

rustup target add "$TARGET"
cargo build --release --target "$TARGET"
cp "target/$TARGET/release/BAMPerfProfiler" BAMPerfProfiler
