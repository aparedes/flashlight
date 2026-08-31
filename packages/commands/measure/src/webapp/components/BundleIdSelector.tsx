import { AppInfo, Platform } from "@lantern/types";
import { AppPicker } from "./AppPicker";
import { Button } from "@lantern/web-reporter-ui";

export const BundleIdSelector = ({
  bundleId,
  onChange,
  autodetect,
  apps,
  platform,
  refreshApps,
}: {
  bundleId: string | null;
  onChange: (bundleId: string) => void;
  autodetect: () => void;
  apps: AppInfo[];
  platform: Platform;
  refreshApps: () => void;
}) => {
  return (
    <>
      <Button onClick={autodetect}>Auto-Detect</Button>
      <div style={{ paddingRight: 5, paddingLeft: 5 }}>
        <AppPicker
          apps={apps}
          platform={platform}
          value={bundleId || ""}
          onChange={onChange}
          onOpen={refreshApps}
        />
      </div>
    </>
  );
};
