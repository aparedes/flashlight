import { AndroidProfiler, LanternSelfProfiler } from "@lantern/android";
import { IOSProfiler } from "@lantern/ios";
import { Profiler } from "@lantern/types";

const getProfiler = (): Profiler => {
  switch (process.env.PLATFORM) {
    case "ios":
      return new IOSProfiler();
    case "lantern":
      return new LanternSelfProfiler();
    default:
      return new AndroidProfiler();
  }
};

export const profiler: Profiler = getProfiler();

// TODO move this to a separate package
export { waitFor } from "@lantern/android";
