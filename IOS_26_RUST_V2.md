# iOS 26+ Rust profiler — v2 implementation prompt

Companion to `IOS_26_RESEARCH.md`. Run this **after** the research session has produced
`RESEARCH_RESULTS_IOS26.md` (and ideally after a v1 backend on pymobiledevice3/go-ios
has validated the metrics end to end). The goal of v2 is a standalone, host-side Rust
binary — `flashlight-ios-profiler` — built on the [`idevice`](https://github.com/jkcoxson/idevice)
crate, replacing the Python/Go dependency with a single static macOS binary, the same
way `rust-profiler` replaced the C++ profiler on Android.

Prerequisites on the Mac: Rust toolchain (rustup), Xcode 26+ CLT, a real iPhone on
iOS 26+ with Developer Mode enabled and connected over USB, this repo checked out on
this branch. Start Claude Code at the repo root and paste the prompt below.

## The prompt

```text
Implement a host-side Rust iOS profiler for Flashlight (this repo). Read these first:

- RUST_MIGRATION.md and packages/platforms/android/rust-profiler/ — the conventions,
  wire protocol, and validation approach the Android Rust profiler established.
- IOS_26_RESEARCH.md and RESEARCH_RESULTS_IOS26.md — what we learned works on iOS 26
  real devices (tunnel mode, sysmontap schema, FPS availability, quirks). If
  RESEARCH_RESULTS_IOS26.md doesn't exist, stop and tell me — the research session
  must run first.
- packages/core/types/index.ts (Profiler interface) and
  packages/platforms/ios/src/index.ts (the old py-ios-device IOSProfiler) — the
  contract the TypeScript side consumes.

Goal: a new crate at packages/platforms/ios/rust-profiler producing a static macOS
binary `flashlight-ios-profiler` (build both aarch64 and x86_64, lipo optional) that
talks to a USB-connected iOS 17–26+ device using the `idevice` crate
(https://github.com/jkcoxson/idevice, docs at https://docs.rs/idevice) and streams
performance measures for a given bundle id to stdout. No Python, no go-ios, no idb at
runtime. Use pymobiledevice3's source as the de facto protocol spec whenever the
`idevice` crate's DVT support falls short.

A real iPhone on iOS 26+ is connected with Developer Mode enabled. You may run cargo
and the binary against it freely. Ask me before anything needing sudo (prefer a
userspace/unprivileged tunnel; if root is unavoidable, say why). Tell me when I need
to unlock the phone or accept a trust/pairing dialog.

Work in milestones, each ending with a commit and a working `cargo test && cargo
clippy && cargo fmt --check`:

M0 — De-risking spike (throwaway code allowed): with the `idevice` crate, discover
the device, pair, establish the CoreDevice/RemoteXPC tunnel, and open ANY DVT
instruments channel on iOS 26. This is the go/no-go gate: if the crate can't get a
DVT channel up on iOS 26, stop and write up exactly what's missing (crate APIs,
upstream issues worth filing, what pymobiledevice3 does differently) instead of
building on sand.

M1 — Device + app plumbing: list connected devices; resolve a bundle id to a pid;
launch and kill the app via DVT process control; detect the foreground app (for
detectCurrentBundleId). Mind the known iOS 26 quirk: use streaming app listing —
non-streaming listapps wedges dtappserviced.

M2 — Sysmontap polling: subscribe to the sysmontap service and emit, every ~500ms,
the target process's CPU %, memory footprint, and thread count (per-thread CPU too if
the research showed it's available). Handle the app restarting (pid change) without
leaking subscriptions — the Android rewrite fixed exactly this class of bug; don't
reintroduce it.

M3 — FPS: implement whatever the research session validated for frame data (DVT
graphics/CoreAnimation channel, or document clearly that FPS is post-hoc-only via
xctrace and out of scope for this binary). Also report the display refresh rate if
obtainable; otherwise emit it as unknown rather than hardcoding 60.

M4 — Wire protocol: settle the stdout format. Default choice: newline-delimited JSON
measures matching the Measure type in packages/core/types (time, cpu.perName,
ram, fps), with structured error lines on stderr prefixed IOS_PROFILER_ERROR_ —
mirroring the Android CPP_ERROR_ convention. Document the protocol in the crate
README. Clean shutdown on SIGINT/SIGTERM must tear down DVT subscriptions and the
tunnel.

M5 — TypeScript integration: rewrite packages/platforms/ios/src/index.ts to spawn
flashlight-ios-profiler and parse its stream, implementing the full Profiler
interface (pollPerformanceMeasures, stopApp, detectCurrentBundleId,
detectDeviceRefreshRate; getScreenRecorder may return undefined for now). Keep
PLATFORM=ios selection in packages/platforms/profiler working. Follow the repo's
existing pattern for locating platform binaries (see how the Android package ships
rust-profiler builds) including an env-var override for a locally built binary.

M6 — Validation: (a) run the binary and pymobiledevice3 monitoring the same app
back-to-back and compare CPU/RAM series — they should track within noise; note any
systematic offset and its cause. (b) 10-minute continuous poll: no disconnects,
unbounded memory, or drift; kill and relaunch the app mid-run and confirm recovery.
(c) run `flashlight measure` and `flashlight test` end to end against the phone with
PLATFORM=ios and confirm the web reporter renders sane results. (d) unit-test the
parsing/protocol layers with recorded fixtures so CI (Linux, no device) still tests
them; add a macOS CI job for build + clippy + fmt if the repo's CI setup allows.

Constraints: don't modify the Android packages or the report/measure UIs beyond
what M5 requires; pin the idevice crate version and record why in Cargo.toml
comments; commit after each milestone with messages following the repo's style;
if you hit an idevice crate limitation, prefer contributing the missing DVT message
handling in our crate (a small dvt module of our own on top of its transport) over
forking. Keep a running IMPLEMENTATION_NOTES_IOS26.md capturing protocol findings
that aren't obvious from code — the next person debugging a September iOS release
will need it.
```

## Notes

- The staged plan (research → v1 on existing tooling → this) is deliberate: M0 is the
  only step with real unknowns, so run it early even if the rest waits.
- Screen recording and per-core CPU are explicitly out of scope for v2; the Profiler
  interface tolerates their absence.
