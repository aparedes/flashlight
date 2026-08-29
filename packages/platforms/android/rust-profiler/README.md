# Rust Profiler

Rust port of the former C++ profiler. This small binary is pushed to the
Android device (`/data/local/tmp/BAMPerfProfiler`) and polls CPU (`/proc/<pid>/task/*/stat`),
RAM (`/proc/<pid>/statm`) and atrace (`trace_pipe`) measures for a given app.

Its stdout is a wire protocol (`=START MEASURE=` / `=SEPARATOR=` / `=STOP MEASURE=`
blocks, `CPP_ERROR_*` markers on stderr) parsed by `@perf-profiler/android`
(`src/commands/cppProfiler.ts` and `UnixProfiler.ts`) — keep them in sync.

Differences from the C++ version:

- `pidof` is implemented natively (scanning `/proc/*/cmdline`) instead of
  shelling out, so the binary has no runtime dependencies at all.
- Binaries are fully static musl builds linked with Rust's bundled `rust-lld`,
  so **no Android NDK (or any C toolchain) is needed** — only `rustup` targets.
- A pid change no longer leaks an extra atrace reader thread per restart.
- A thread disappearing mid-measure is skipped instead of aborting the process.

## Release

To build all executables in the bin folder, run:

```sh
./build_all_abi.sh
```

## Run locally

Build for your device architecture, push and run in one go:

```sh
./run.sh [command] <arguments>
# For instance
./run.sh pollPerformanceMeasures com.example 500
```

## Tests

```sh
cargo test
```
