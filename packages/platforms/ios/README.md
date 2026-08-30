# Measure the performance of any iOS app

Implementation of the Flashlight `Profiler` for real iOS devices.

It spawns the bundled Rust binary (`rust-profiler/`,
`flashlight-ios-profiler`) which talks to the device over usbmuxd and the
instruments services — the CoreDevice tunnel on iOS 17+ (including iOS 26),
or the legacy lockdown service before that — and streams CPU, RAM and FPS as
NDJSON. No Python, idb, sudo, or external tunnel daemon required.

## Requirements

- macOS host with the device connected over USB
- Developer Mode enabled on the device
- The personalized Developer Disk Image mounted (opening the device once in
  Xcode, or `devicectl`, or `pymobiledevice3 mounter auto-mount` all do this)
- The profiler binary built: `rust-profiler/build_macos.sh` (or set
  `FLASHLIGHT_IOS_BINARY_PATH` to a binary you built elsewhere)

## Usage

```bash
PLATFORM=ios flashlight measure
# or from source:
PLATFORM=ios bun packages/commands/measure/dist/server/bin.js measure
```

See `rust-profiler/README.md` for the binary's CLI and wire protocol, and
`IMPLEMENTATION_NOTES_IOS26.md` at the repo root for validation status.
