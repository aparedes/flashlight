# iOS Rust profiler — implementation notes & pending validation

Companion to `IOS_26_RESEARCH.md` / `IOS_26_RUST_V2.md`. The Rust profiler
(`packages/platforms/ios/rust-profiler`) and its TypeScript integration
(`packages/platforms/ios`) were written and unit-tested on Linux, where no
device or macOS toolchain is available. Everything protocol-level compiles and
is fixture-tested; everything device-level below **must be validated on a Mac
with a real iOS 26 device** before this ships.

## Architecture (as built)

- `connect.rs` — usbmuxd discovery → `CoreDeviceProxy` → CDTunnel → jktcp
  userspace TCP → RSD → `com.apple.instruments.dtservicehub` (iOS 17+),
  falling back to lockdown `com.apple.instruments.remoteserver` (iOS < 17).
  No sudo, no external daemon: the tunnel lives in-process.
- **One instruments connection for everything**, with sysmontap and graphics
  as multiplexed DTX channels addressed by code via the client's public
  `read_message(channel)`/`call_method(channel, ...)`. Validated on a real
  iOS 26 device (2026-08-30): opening multiple concurrent dtservicehub
  connections gets them closed by the peer ("remote server connection
  closed"), so the earlier connection-per-tap design was rebuilt. Channel
  codes are deterministic (make_channel allocates 1, 2, ... per attempt);
  on any app-listing hiccup the connection is reopened so streaming codes
  stay known.
- `poll.rs` — sysmontap drives emission (one measure per sample); queued
  graphics frames are drained (1ms timeout reads) before each measure so
  fps is fresh; fps omitted until the first frame. Target matched by
  executable name every sample → survives app restarts.
  `FLASHLIGHT_IOS_DEBUG=1` dumps the first raw sysmontap sample to stderr
  (for verifying attribute order and the cpuUsage scale).
- Wire protocol: NDJSON on stdout (`measure` matches `@perf-profiler/types`),
  `IOS_PROFILER_ERROR_*` markers on stderr. Documented in the crate README.
- TS side spawns the binary; path override: `FLASHLIGHT_IOS_BINARY_PATH`.

## Needs on-device validation (in order of risk)

1. ~~Tunnel bring-up on iOS 26~~ **VALIDATED 2026-08-30**: CDTunnel + RSD +
   dtservicehub DVT channels all work on a real iOS 26 device (app listing
   returned data). Single-connection constraint discovered and fixed — see
   architecture above.
2. **sysmontap row shape.** Parser handles both array-ordered (per procAttrs)
   and dict-keyed rows; verify which iOS 26 sends, and that
   `pid/name/cpuUsage/physFootprint/threadCount` all populate. Capture a raw
   sample as a test fixture.
3. **CPU scale.** `cpuUsage` is assumed to be a fraction of one core
   (0.35 = 35%); compare against Xcode Instruments on the same app. If it's
   already a percentage, drop the ×100 in `ProcessSample::cpu_percent`.
4. **graphics.opengl on iOS 26.** The FPS service is the part Apple most
   plausibly broke; pymobiledevice3 doesn't expose it in its CLI (issue #871).
   If dead: fall back to xctrace post-hoc frame data, or leave fps absent.
5. **App-listing key names** (`CFBundleIdentifier` vs `BundleIdentifier`,
   `ExecutableName` vs `CFBundleExecutable` vs path) — verify which iOS 26
   returns; the code tries all candidates.
6. **Stability.** 10-minute poll, app kill/relaunch mid-run (expect
   `targetLost` → `target` with a new pid), Mac-side CPU overhead.
7. **End to end.** `PLATFORM=ios flashlight measure` / `flashlight test`
   against the phone; check the web reporter renders sane series.
8. **Refresh rate** is still hardcoded to 60 in the TS layer; decide how to
   detect ProMotion (120 Hz) — possibly from `info` hardware output.

## Known gaps (deliberate)

- No per-thread CPU (sysmontap doesn't provide it) and no per-core data.
- No screen recording (`getScreenRecorder` returns undefined).
- `detectCurrentBundleId` throws — pass the bundle id explicitly.
- macOS binaries aren't committed; `build_macos.sh` produces them. Decide on
  distribution (commit like Android's, or build in CI) once validated.

## Build/test status on Linux (2026-08-29)

`cargo build`, `cargo test` (9 tests), `cargo clippy` (0 warnings),
`cargo fmt --check` all green. `tsc --build packages/platforms/ios` clean;
`bun run test:unit:node` 38/38. Pre-existing failures unrelated to this work:
`web-reporter-ui` ApexCharts typings and `core/shell` adm-zip declarations
fail on a clean checkout in this environment too.
