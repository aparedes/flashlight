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
  `LANTERN_IOS_DEBUG=1` dumps the first raw sysmontap sample to stderr
  (for verifying attribute order and the cpuUsage scale).
- Wire protocol: NDJSON on stdout (`measure` matches `@lantern/types`),
  `IOS_PROFILER_ERROR_*` markers on stderr. Documented in the crate README.
- TS side spawns the binary; path override: `LANTERN_IOS_BINARY_PATH`.

## Validation status

**2026-08-30: `poll` VALIDATED end to end on a real iOS 26 device** — tunnel,
DVT, sysmontap and graphics all working, measures streaming. Root causes
fixed along the way: missing DTX capability handshake (DTXBlockCompression),
one-connection-only dtservicehub, and sysmontap requiring the device's own
attribute lists. Remaining checks below.

## Needs on-device validation (in order of risk)

1. ~~Tunnel bring-up on iOS 26~~ **VALIDATED 2026-08-30**: CDTunnel + RSD +
   dtservicehub DVT channels all work on a real iOS 26 device (app listing
   returned data). Single-connection constraint discovered and fixed — see
   architecture above.
2. ~~sysmontap row shape~~ **VALIDATED**: rows parse and measures emit on
   iOS 26 (still worth capturing a LANTERN_IOS_DEBUG sample as a fixture).
3. ~~CPU scale~~ **VALIDATED**: sysmontap's `cpuUsage` is already a percentage
   of one core (see the doc comment on `ProcessSample::cpu_usage`); no ×100.
4. ~~graphics.opengl on iOS 26~~ **VALIDATED**: channel opens and samples
   on iOS 26 (confirm fps values look sane while scrolling).
5. ~~App-listing key names~~ **VALIDATED 2026-08-30** (`apps` on iOS 26):
   every entry has `CFBundleIdentifier`, `ExecutableName`, `DisplayName`,
   `BundlePath`, `Type` (`User` | `PluginKit` | `Unknown`), `Restricted`;
   most have `Version`; `User`/`Unknown` entries carry `Placeholder`
   (`"True"`/`"False"` strings). On a lived-in phone: 1841 entries, of which
   384 `User` (third-party apps), 11 `Unknown` (Apple-published App Store apps
   such as Pages/TestFlight) and 1446 `PluginKit` extensions. `ExecutableName`
   can differ from the bundle folder name (e.g. Netflix → `Argo`), so the
   listing lookup in `sysmon::executable_name_from_app` is required.
   `info` (`hardwareInformation`) returns only CPU keys (`hwCPUtype`,
   `hwCPUsubtype`, `numberOfCpus`, …) — nothing about the display, so refresh
   rate detection needs a model lookup, not this call.
6. **Stability.** 10-minute poll, app kill/relaunch mid-run (expect
   `targetLost` → `target` with a new pid), Mac-side CPU overhead.
7. **End to end.** `PLATFORM=ios lantern measure` / `lantern test`
   against the phone; check the web reporter renders sane series.
8. ~~**Refresh rate** is still hardcoded to 60 in the TS layer~~ **Resolved
   2026-08-30:** `info` carries no display keys, so the TS layer derives
   ProMotion (120 Hz) from the `ProductType` reported by `devices`
   (`isProMotionModel` in `packages/platforms/ios/src/index.ts`), defaulting to 60. `LANTERN_IOS_REFRESH_RATE` overrides it for models the table gets
   wrong; still worth confirming against a real ProMotion device.

## Known gaps (deliberate)

- No per-thread CPU (sysmontap doesn't provide it) and no per-core data.
- No screen recording (`getScreenRecorder` returns undefined).
- `detectCurrentBundleId` uses a `running-apps` heuristic: it returns the
  bundle id when exactly one user app is running, and otherwise asks the user
  to pick one (iOS has no "focused app" API outside Instruments).
- ~~macOS binaries aren't committed~~ **Resolved 2026-08-30:** the per-arch
  macOS binaries are committed in `rust-profiler/bin/` (like Android's) and
  `build:standalone` embeds the one matching its target; a macOS CI job
  rebuilds them from source. Only the universal `lipo` output stays ignored.

## Build/test status on Linux (2026-08-29)

`cargo build`, `cargo test` (9 tests), `cargo clippy` (0 warnings),
`cargo fmt --check` all green. `tsc --build packages/platforms/ios` clean;
`bun run test:unit:node` 38/38. Pre-existing failures unrelated to this work:
`web-reporter-ui` ApexCharts typings and `core/shell` adm-zip declarations
fail on a clean checkout in this environment too.
