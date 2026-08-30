#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

./build_for_abi.sh "$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
adb push lantern-android-profiler /data/local/tmp/lantern-android-profiler
adb shell /data/local/tmp/lantern-android-profiler "$@"
