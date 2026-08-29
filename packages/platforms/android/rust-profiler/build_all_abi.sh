#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

for abi in arm64-v8a
do
  echo "Building for $abi"
  ./build_for_abi.sh $abi
  mv BAMPerfProfiler bin/BAMPerfProfiler-$abi
done
