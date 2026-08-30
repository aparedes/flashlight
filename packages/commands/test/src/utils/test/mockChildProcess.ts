import * as childProcess from "child_process";
import { spyOn } from "bun:test";

const execSync = ((command: string) => ({
  toString: () => {
    if (
      command.startsWith("adb push") &&
      command.endsWith(
        "lantern-android-profiler-arm64-v8a /data/local/tmp/lantern-android-profiler"
      )
    ) {
      return "";
    }

    switch (command) {
      case "adb shell /data/local/tmp/lantern-android-profiler printCpuClockTick":
        return 100;
      case "adb shell dumpsys window windows":
        return "      mSurface=Surface(name=com.example/com.example.MainActivity$_21455)/@0x9110fea";
      case "adb shell /data/local/tmp/lantern-android-profiler printRAMPageSize":
        return 4096;
      case "adb shell getprop ro.product.cpu.abi":
        return "arm64-v8a";
      case "adb shell getprop ro.build.version.sdk":
        return "30";
      case 'adb shell dumpsys display | grep -E "mRefreshRate|DisplayDeviceInfo"':
        return "fps=120";
      case "adb shell setprop debug.hwui.profile true":
      case "adb shell atrace --async_stop 1>/dev/null":
      case "adb shell chmod 755 /data/local/tmp/lantern-android-profiler":
        return "";
      default:
        console.error(`Unknown command: ${command}`);
        return "";
    }
  },
})) as unknown as typeof childProcess.execSync;

spyOn(require("child_process") as typeof childProcess, "execSync").mockImplementation(execSync);
