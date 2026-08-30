# flashlight-ios-profiler

Host-side Rust profiler for real iOS devices, built on the
[`idevice`](https://github.com/jkcoxson/idevice) crate. It replaces the
py-ios-device (`pyidevice`) dependency: a single static binary, no Python, no
idb, no sudo, no external tunnel daemon.

## How it connects

- **iOS 17+ (incl. iOS 26):** usbmuxd → lockdown → `CoreDeviceProxy` →
  CDTunnel handshake → userspace TCP stack (`jktcp`) over the tunnel's raw
  IPv6 packets → RSD handshake → `com.apple.instruments.dtservicehub`.
  Everything runs in-process and unprivileged.
- **iOS < 17:** falls back to the lockdown
  `com.apple.instruments.remoteserver` service automatically.

The personalized Developer Disk Image must be mounted (Xcode, `devicectl`, or
`pymobiledevice3 mounter auto-mount` all do this). If instruments services are
missing from RSD, that is the first thing to check. Developer Mode must be
enabled on the device.

## Commands

```
flashlight-ios-profiler devices
flashlight-ios-profiler apps    [--udid <udid>]
flashlight-ios-profiler info    [--udid <udid>]
flashlight-ios-profiler launch  --bundle-id <id> [--udid <udid>]
flashlight-ios-profiler kill    --bundle-id <id> | --pid <n> [--udid <udid>]
flashlight-ios-profiler poll    --bundle-id <id> [--interval-ms <n=500>] [--udid <udid>]
```

## Wire protocol (`poll`)

One JSON object per stdout line (NDJSON):

```json
{"type":"status","event":"started","detail":"polling com.example.app every 500ms (tunnel: CoreDevice)"}
{"type":"status","event":"target","pid":1234,"name":"MyApp"}
{"type":"measure","time":1700000000000,"cpu":{"perName":{"Total":25.5},"perCore":{}},"ram":123.4,"fps":59.9,"threadCount":17,"pid":1234}
{"type":"status","event":"targetLost"}
{"type":"status","event":"stopped"}
```

- `measure` matches the `Measure` type in `@lantern/types`: `time` is
  epoch ms, `cpu.perName.Total` is percent of one core (can exceed 100 on
  multiple cores), `ram` is MB (phys footprint), `fps` is CoreAnimation FPS
  and is omitted until the first graphics sample arrives.
- CPU comes from the DVT `sysmontap` service (whole-process only — per-thread
  CPU is not available from sysmontap), FPS from the DVT `graphics.opengl`
  service. Both are channels multiplexed over one instruments connection
  (iOS 26 closes concurrent `dtservicehub` connections).
- The target process is matched by executable name (resolved via the
  application-listing service) falling back to the bundle id and its last
  component, every sample — so an app relaunch (new pid) re-attaches
  automatically and emits `targetLost`/`target` transitions.
- Errors are marked on stderr as `IOS_PROFILER_ERROR_<CODE>: message`
  (`NO_DEVICE`, `TUNNEL_FAILED`, `SERVICE_FAILED`, `APP_NOT_FOUND`,
  `STREAM_ENDED`, `USAGE`), mirroring the Android profiler's `CPP_ERROR_*`
  convention.
- SIGINT/SIGTERM stop both taps cleanly and end with a `stopped` status.

## Building

On macOS (the only platform that can reach a device over usbmuxd out of the
box):

```
./build_macos.sh   # builds aarch64 + x86_64 release binaries into bin/
```

The per-arch binaries in `bin/` (`flashlight-ios-profiler-aarch64-apple-darwin`,
`flashlight-ios-profiler-x86_64-apple-darwin`) are committed, mirroring the
Android profiler: `@lantern/ios` resolves `bin/flashlight-ios-profiler`
(the universal `lipo` output, gitignored) from a source checkout, and
`bun run build:standalone` embeds the binary matching its `--target`. Commit
the rebuilt binaries together with the crate change that motivated them.

CI runs `cargo fmt/clippy/test` and `build_macos.sh` on a macOS runner; the
crate also compiles and unit-tests on Linux.

## Validation status

Written against idevice 0.1.65 (pinned). Validated end to end on a real iOS 26
device on 2026-08-30 (tunnel, sysmontap, graphics FPS, CPU scale). Remaining
checks and known gaps: `IMPLEMENTATION_NOTES_IOS26.md` at the repo root.
