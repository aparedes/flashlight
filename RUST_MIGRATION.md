# Rust Migration

## Done — on-device Android profiler (`rust-profiler`)

The C++ profiler (`packages/platforms/android/cpp-profiler`, ~400 lines) was the only
native component in the repo and is now `packages/platforms/android/rust-profiler`.
It was the ideal migration target: a standalone binary with a small, well-defined
stdout protocol, no build integration with the TS workspace, and real correctness
stakes (it runs unattended on devices for minutes at a time).

What the migration bought us, beyond the rewrite itself:

- **No Android NDK.** The binaries are fully static musl builds linked with the
  `rust-lld` bundled in the Rust toolchain. Building the one supported ABI
  (arm64-v8a — real devices and the emulator on Apple Silicon; the unused
  armeabi-v7a, x86 and x86_64 ABIs were dropped) needs only
  `rustup target add` (`./build_all_abi.sh` does everything) — the previous CMake +
  NDK toolchain requirement is gone.
- **No runtime dependencies.** `pidof` is now a native `/proc/*/cmdline` scan
  instead of `popen("pidof …")`, so the binary no longer needs a shell on the device.
- **Smaller artifacts.** 390–450 KB per ABI vs 1.6–2.0 MB for the C++ builds.
- **Fixed latent bugs.** A pid change no longer leaks an extra atrace reader thread
  per restart, and a thread disappearing mid-measure (a filesystem race that
  `std::terminate`'d the C++ binary) now just skips that file.
- **Tests + CI.** The pidof matching rules are unit-tested (`cargo test`), and CI
  runs fmt/clippy/test plus a cross-compile of the shipped ABI on every push.

The wire protocol (`=START MEASURE=` / `=SEPARATOR=` / `=STOP MEASURE=` blocks and
the `CPP_ERROR_*` stderr markers) is byte-compatible — verified by diffing Rust vs
C++ output for the same pid on Linux — so the TypeScript side only needed the
binary folder path updated.

## Evaluated — not worth migrating (for now)

Everything else in the repo is host-side orchestration or UI; none of it is
CPU-bound enough for a Rust rewrite to pay for the added toolchain surface:

- **Measure parsing/aggregation** (`parseCppMeasure`, `getCpuStatsByProcess`,
  `CpuMeasureAggregator`, `FrameTimeParser`, `pollRamUsage` — ~400 lines of TS).
  Runs once per 500 ms polling interval on a few KB of text. Performance is
  irrelevant at that scale, and the code is entangled with the `Profiler`
  interface and its test suite.
- **iOS Instruments trace parsing** (`ios-instruments/src/writeReport.ts`,
  `fast-xml-parser` over `.trace` XML exports). The only spot that touches
  potentially large inputs, but it runs once per test run, on macOS only —
  shipping per-platform host binaries would cost more than the parse time saved.
- **CLI / servers / web UIs** (adb & idb orchestration, the Bun-native measure
  server, the React reporters). I/O-bound or browser code; Rust adds nothing.
- **Toolchain** — already Rust via the modernization work: oxlint, oxfmt, and
  oxc's React Compiler port (see `MODERNIZATION_PLAN.md`).

## Possible follow-up (architectural, not a port)

The one genuinely interesting next step would be moving the measure
_pre-processing_ on-device: have `rust-profiler` parse stat/statm/atrace itself
and emit compact JSON measures instead of raw dumps. That would cut the adb
transfer (atrace lines dominate it), delete the TS parsing layer, and make the
protocol schema-checked end to end. It is deliberately not done here because it
changes the wire protocol consumed by `UnixProfiler`/`parseCppMeasure` and the
`FLASHLIGHT_BINARY_PATH` override contract, and deserves its own design pass.
