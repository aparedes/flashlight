#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Build the Apple Silicon release binary into bin/. Run on macOS.
#
# Only arm64 is shipped: Apple has retired Intel Macs from macOS support, and the project
# has no Intel machine to build or test on. The committed binary is what `@lantern/ios`
# spawns from a source checkout and what `bun run build:standalone` embeds.
TARGET=aarch64-apple-darwin

mkdir -p bin
rustup target add "$TARGET" >/dev/null
echo "Building for $TARGET"
cargo build --release --target "$TARGET"
cp "target/$TARGET/release/lantern-ios-profiler" bin/lantern-ios-profiler
echo "Wrote bin/lantern-ios-profiler"
