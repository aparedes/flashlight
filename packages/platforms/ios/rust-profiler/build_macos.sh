#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Build universal macOS binaries into bin/. Run on macOS.
mkdir -p bin
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target add "$target" >/dev/null
  echo "Building for $target"
  cargo build --release --target "$target"
  cp "target/$target/release/lantern-ios-profiler" "bin/lantern-ios-profiler-$target"
done

lipo -create -output bin/lantern-ios-profiler bin/lantern-ios-profiler-*-apple-darwin 2>/dev/null \
  && echo "Created universal binary bin/lantern-ios-profiler" \
  || cp bin/lantern-ios-profiler-aarch64-apple-darwin bin/lantern-ios-profiler
