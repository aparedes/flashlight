import { Platform } from "@lantern/types";
import { getInk } from "../ink";

export const HostAndPortInfo = ({ url, platform }: { url: string; platform: Platform }) => {
  const { Box, Text } = getInk();

  return (
    <Box padding={1} flexDirection="column">
      <Text>
        <Text bold>Lantern web app running on: </Text>
        <Text color={"blue"}>{url}</Text>
      </Text>
      <Text>
        Platform: <Text bold>{platform === "ios" ? "iOS" : "Android"}</Text>
      </Text>
    </Box>
  );
};
