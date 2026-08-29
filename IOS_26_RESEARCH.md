# iOS 26+ support research

Status of the ecosystem as of August 2026, and a ready-to-use prompt for a hands-on
research session on a macOS machine with a real iOS 26 device attached.

## Background: what Flashlight has today

- `packages/platforms/ios` (`IOSProfiler`): polls CPU/RAM/FPS in real time via
  `pyidevice` (py-ios-device). **Real devices, iOS < 17 only** — it speaks the old
  lockdownd/DVT protocol that Apple locked down in iOS 17.
- `packages/platforms/ios-instruments` (`flashlight-ios-poc`): simulator-only POC using
  `xcrun xctrace` + a manual Instruments template + Maestro. Post-hoc CPU only (no
  RAM/FPS), single iteration, not wired into `flashlight test`/`measure`.

## Ecosystem findings (desk research)

### pymobiledevice3 — the leading candidate

- Actively maintained; supports iOS 17+ over USB via the CoreDevice/RemoteXPC tunnel
  (`CoreDeviceProxy` on 17.4+, RemotePairing over Wi-Fi on 17.0–17.3.1). A tunnel
  (`tunneld` daemon, or `--userspace` in-process tunnel) is required for any DVT
  developer service.
- Recent releases added request fields **iOS 26 requires**; known iOS 26 quirk: the
  non-streaming `listapps` wedges `dtappserviced` — `stream-apps` is the replacement.
- `developer dvt sysmon process monitor` streams **per-process CPU, memory footprint and
  thread counts** in real time — a direct replacement for `pyidevice instruments appmonitor`.
- **FPS is the open question**: not exposed in the main CLI (see upstream issue #871);
  the underlying DVT `graphics` (CoreAnimation) service exists but needs verification
  on iOS 26.

### py-ios-device (current dependency)

- Effectively unmaintained for the tunnel era; no iOS 17+/26 path. Should be treated as
  end-of-life for our purposes.

### xctrace (Instruments CLI)

- Works against real devices (`--device <UDID>`) with bundled templates (Time Profiler,
  Animation Hitches, Activity Monitor…), so it's a valid iOS 26 path — but it is
  **record-then-export** (XML via `xctrace export`), not real-time, which fits
  `flashlight test` but not `flashlight measure`.

### go-ios

- Alternative implementation of the same tunnel + instruments services (needs
  `sudo ios tunnel start` on 17+); actively maintained with iOS 26-era fixes. A fallback
  if pymobiledevice3 gaps out, and interesting because it ships as a single binary.

### Maestro (test driver)

- iOS 26 supported since CLI 2.4.0 (`--device-os=iOS-26`); real-device iOS support now
  exists via third-party runners (TestingBot, devicelab-dev maestro-ios-device /
  maestro-runner), simulators supported natively.

### Sources

- https://github.com/doronz88/pymobiledevice3 and
  https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md
- https://github.com/doronz88/pymobiledevice3/issues/871 (FPS monitor)
- https://github.com/YueChen-C/py-ios-device
- https://keith.github.io/xcode-man-pages/xctrace.1.html
- https://github.com/danielpaulus/go-ios
- https://maestro.dev/blog/maestro-cli-2-4-0
- https://github.com/bamlab/flashlight/issues/106 (iOS support tracking issue)

## Hands-on research prompt (run on macOS)

Prerequisites on the Mac: Xcode 26+ with command line tools, Homebrew, Python 3.11+,
a real iPhone on iOS 26+ with Developer Mode enabled, connected over USB, and ideally a
simulator too. Then start Claude Code in a checkout of this repo and paste the prompt
below.

```text
I'm researching how to bring real iOS 26+ device support to Flashlight (this repo), a
mobile performance-measurement CLI. Read IOS_26_RESEARCH.md,
packages/platforms/ios/src/index.ts, packages/platforms/ios-instruments/src/, and
packages/core/types/index.ts (the Profiler interface) first so you know what the tool needs:
real-time polling (~500ms) of per-process CPU (ideally per-thread), RAM, and FPS for a
given bundle id, plus stopApp, detectCurrentBundleId, refresh-rate detection, and
optionally screen recording.

A real iPhone running iOS 26+ is connected over USB with Developer Mode enabled. You may
install tools (brew, pipx/pip, npm) and run them against the device. Don't install
anything on the phone other than launching already-installed apps. Ask me before
anything that needs sudo, and tell me when you need me to unlock the phone or tap a
trust dialog.

Work through these experiments, keeping notes as you go:

1. Inventory: Xcode/xctrace/devicectl versions; `xcrun devicectl list devices` and
   `xcrun xctrace list devices` both see the phone; note the exact iOS version.

2. pymobiledevice3 (main candidate): install latest, establish a tunnel (prefer a
   non-sudo/userspace option; use `sudo pymobiledevice3 remote tunneld` only if
   required — ask me first). Then verify on iOS 26:
   - `developer dvt sysmon process monitor` (or equivalent): can we stream per-process
     CPU %, memory, and thread count for a chosen bundle id at ~500ms intervals? What
     does the output schema look like? Is per-thread CPU available at all?
   - FPS: try `developer dvt graphics` / the CoreAnimation service (upstream issue #871
     says the CLI may not expose it — if so, try a short Python script against
     pymobiledevice3's DVT graphics API directly). Can we get a real-time FPS stream?
   - App control: launch/kill an app by bundle id, list apps (use the streaming
     variant — plain listapps is known to hang dtappserviced on iOS 26), and detect the
     foreground app (for detectCurrentBundleId).
   - Screen/refresh rate detection, and screenshot/screen-recording options.
   - Stability: run a 5-minute continuous monitor; note disconnects, drift, CPU overhead
     on the Mac, and whether the tunnel survives.

3. xctrace on the real device: record 30s of Time Profiler and Activity Monitor (and
   Animation Hitches for frame data) attached to a running app; export via
   `xctrace export --xpath ...` and check whether per-thread CPU, memory, and
   frame/hitch data are recoverable from the XML. Measure how long export takes — is a
   record-then-parse flow viable per test iteration?

4. Quick comparison: install go-ios and check whether its tunnel + instruments commands
   give anything pymobiledevice3 can't (or work where it fails).

5. Driver: verify Maestro can drive the app during a measurement (simulator natively;
   note what real-device Maestro requires) while step 2's monitor is running — confirm
   they don't fight over the tunnel/instruments session.

Deliverable: write RESEARCH_RESULTS_IOS26.md in the repo root containing (a) a matrix of
each Profiler interface method vs. what tool/command can implement it on iOS 26 real
devices, with actual sample outputs from the phone; (b) exact setup steps that worked
(versions, tunnel mode, sudo or not); (c) blockers found, with upstream issue links;
(d) a recommendation: real-time pymobiledevice3-based profiler vs. xctrace post-hoc vs.
hybrid, and what to do about FPS. Don't modify any existing source files — research
only, everything goes in the results doc.
```
