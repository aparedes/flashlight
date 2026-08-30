import type { LanternData } from "../common/types";

declare global {
  interface Window {
    __LANTERN_DATA__: LanternData;
  }
}

export {};
