#!/usr/bin/env bash
set -euo pipefail

ABI=${1:?Usage: ./build_for_abi.sh <armeabi-v7a|arm64-v8a|x86|x86_64>}

# Fully static musl builds: they run on any Android device (API 23+)
# straight from adb shell, and no Android NDK is required to build them.
case "$ABI" in
  armeabi-v7a) TARGET=armv7-unknown-linux-musleabihf ;;
  arm64-v8a)   TARGET=aarch64-unknown-linux-musl ;;
  x86)         TARGET=i686-unknown-linux-musl ;;
  x86_64)      TARGET=x86_64-unknown-linux-musl ;;
  *) echo "Unknown ABI: $ABI" >&2; exit 1 ;;
esac

rustup target add "$TARGET"
cargo build --release --target "$TARGET"
cp "target/$TARGET/release/BAMPerfProfiler" BAMPerfProfiler
